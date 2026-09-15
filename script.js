/* ============================================================================
   SWEET HOME — BUDGET DASHBOARD
   ----------------------------------------------------------------------------
   This file is organized into clearly labeled sections so it reads top to
   bottom like a story:

     1. Configuration & global state
     2. Data fetching (talking to the Google Sheets backend)
     3. Data transformation (turning raw rows into dashboard-ready numbers)
     4. Local cache (instant load using localStorage)
     5. Dashboard bootstrapping & month switching
     6. Background sync (keeps data fresh without the user asking)
     7. Month picker UI (the custom dropdown in the header)
     8. Metrics slider (the "Current Balance / Savings / ..." carousel)
     9. Expense & income lists
    10. Transaction history page
    11. Page navigation (sidebar tabs, mobile menu)
    12. Receipt upload (drag & drop, camera, file picker)
    13. Startup (what actually kicks everything off)

   Nothing about *how* the app behaves has changed here — only the order of
   the code and the comments explaining *why* each part exists. If you're
   learning from this file, read the section headers first to get the shape
   of the app before diving into any one function.
   ============================================================================ */


/* ============================================================================
   1. CONFIGURATION & GLOBAL STATE
   ----------------------------------------------------------------------------
   These are the values every other part of the app reads from or writes to.
   Keeping them together (instead of scattered near whichever function first
   used them) makes it easy to answer "what does this app actually track?"
   at a glance.
   ============================================================================ */

// The Apps Script web app URL that stands in for a real backend/database.
// Every network request in this file — months, transactions, receipt
// uploads — goes to this one URL with a different `?action=` query param.
const GOOGLE_SCRIPT_URL =
    'https://script.google.com/macros/s/AKfycbz7bQN377P10T0zuKUNuD4CDzqoXsg-VwUh9s-9Iwb-4tMUAbWNJzYgaSq3lpXag0lT/exec';

// globalBudgetData holds the *computed* dashboard numbers, one entry per
// month, keyed by a label like "September 2026":
//   { "September 2026": { startBalance, endBalance, expenses: {...}, ... } }
// A month only gets an entry here once its transactions have actually been
// fetched and processed by buildBudgetData() — it's a cache of *derived*
// data, not raw data.
const globalBudgetData = {};

// globalTransactionsData holds the *raw* transaction rows per month, keyed
// the same way. This is what the Transaction History page reads from — it
// needs the individual rows (date, store, amount), not the rolled-up totals
// that globalBudgetData stores.
const globalTransactionsData = {};

// Tiny formatting helper used everywhere a number needs to look like money.
// Math.abs() means the sign is handled separately by the caller (usually via
// CSS classes like text-danger/text-success) rather than a literal "-" here.
const formatCurrency = (num) => `¥${Math.abs(num).toLocaleString()}`;

// Which slide of the metrics carousel is currently showing (0-indexed).
let currentSlide = 0;

// Simple in-flight guard so two month-fetches can't run at once — see
// changeMonth() and silentBackgroundSync() in section 5/6 for why this
// matters (both can be triggered independently, e.g. a user click while a
// background sync is running).
let isFetchingMonthData = false;

// Whether the metrics slider's auto-advance timer should be paused right
// now (true while the user's mouse/finger is on the slider).
let isPaused = false;


/* ============================================================================
   2. DATA FETCHING (JSONP)
   ----------------------------------------------------------------------------
   Why JSONP instead of a normal fetch()? Google Apps Script web apps don't
   send CORS headers that let `fetch()` read their response from a different
   origin. JSONP sidesteps that by injecting a <script> tag pointing at the
   URL — browsers are allowed to *execute* scripts cross-origin, just not
   *read* their raw response with fetch/XHR. The backend is written to wrap
   its JSON response in a function call (the `callback` query param), so when
   the script loads, it literally calls a function we defined beforehand with
   the data as an argument. That's the whole trick.
   ============================================================================ */

// Fetches the list of months that have data available (for the month picker).
// Returns a Promise so callers can `await` it like a normal fetch.
function loadMonthNames() {
    return new Promise((resolve, reject) => {
        // A unique function name per call, so overlapping requests (rare,
        // but possible) don't stomp on each other's callback.
        const callbackName = `monthCallback_${Date.now()}`;

        // This is the function the backend's JSONP response will call.
        // We attach it to `window` because that's the only scope a
        // dynamically injected <script> tag can see.
        window[callbackName] = result => {
            delete window[callbackName]; // clean up so window doesn't accumulate junk
            script.remove();             // the <script> tag has done its job

            console.log("RAW BACKEND RESULT:", result); // 🔍 DEBUG LINE

            if (!result.success) {
                reject(new Error('Could not load month names'));
                return;
            }

            resolve(result.months);
        };

        const script = document.createElement('script');
        script.src = `${GOOGLE_SCRIPT_URL}?action=months&callback=${callbackName}`;

        script.onerror = () => {
            delete window[callbackName];
            script.remove();
            reject(new Error('Could not connect to Google Sheets'));
        };

        document.body.appendChild(script); // actually triggers the request
    });
}

// Fetches raw transaction rows for one specific month (or the current month
// if `yearAndMonth` is falsy). Same JSONP pattern as loadMonthNames() above.
function loadSpreadsheetData(yearAndMonth) {
    return new Promise((resolve, reject) => {
        const callbackName = `sheetCallback_${Date.now()}`;

        window[callbackName] = result => {
            delete window[callbackName];
            script.remove();

            console.log("RAW BACKEND RESULT:", result); // 🔍 DEBUG LINE

            if (!result.success) {
                reject(new Error('Could not load sheet data'));
                return;
            }

            resolve(result);
        };

        const script = document.createElement('script');

        // "September 2026" -> ["September", "2026"]. If nothing was passed
        // in, default to today's month/year instead.
        const [targetMonth, targetYear] = yearAndMonth
            ? yearAndMonth.split(' ')
            : [new Date().toLocaleString('en-US', { month: 'long' }), new Date().getFullYear().toString()];

        script.src =
            `${GOOGLE_SCRIPT_URL}?action=transactions&year=${targetYear}&month=${targetMonth}&callback=${callbackName}`;

        script.onerror = () => {
            delete window[callbackName];
            script.remove();
            reject(new Error('Spreadsheet request failed'));
        };

        document.body.appendChild(script);
    });
}


/* ============================================================================
   3. DATA TRANSFORMATION
   ----------------------------------------------------------------------------
   The backend hands us a flat list of transaction rows. Nothing on screen
   wants a flat list, though — the slider wants totals, the lists want
   per-category breakdowns. This function is the one place that bridges
   "raw rows" to "shape the UI actually renders."
   ============================================================================ */

// Converts { transactions: [...], startingBalance, netSaving } into a
// dashboard-ready object, then wraps it as { "September 2026": {...} } so
// the caller can directly Object.assign() it into globalBudgetData.
function buildBudgetData(rawData, targetMonthKey) {
    const transactions = rawData.transactions || [];
    const netSavings = rawData.netSaving || 0;
    const startingBalance = rawData.startingBalance || 0;

    console.log("Building budget data from transactions:", transactions);
    console.log("Starting balance:", startingBalance, "Net savings:", netSavings);

    // Placeholder now, calculated properly below once we know totals.
    let currentMonthSavings;

    const monthData = {
        startBalance: startingBalance,
        currentMonthSavings: currentMonthSavings || 0,
        endBalance: 0,
        netSavings: netSavings,
        expenses: { planned: 0, actual: 0, categories: [] },
        income: { planned: 0, actual: 0, categories: [] }
    };

    // Walk every transaction once, sorting each into either the income or
    // expense bucket, and rolling it up by category as we go.
    transactions.forEach(transaction => {
        if (!transaction.date.includes('/')) {
            console.warn(`Skipping transaction with invalid date format: ${transaction.date}`);
            return;
        }

        const target = transaction.category === 'Income'
            ? monthData.income
            : monthData.expenses;

        // Math.abs() because the sheet might store expenses as negative
        // numbers — the dashboard always wants a positive magnitude and
        // handles "is this good or bad" separately via color, not sign.
        const amount = Math.abs(transaction.amount);
        target.actual += amount;

        const category = target.categories.find(item => item.name === transaction.category);
        if (category) {
            category.actual += amount;
        } else {
            target.categories.push({
                name: transaction.category,
                planned: 0,
                actual: amount
            });
        }
    });

    // ENDING balance = what you started with + what came in − what went out
    monthData.endBalance = monthData.startBalance + monthData.income.actual - monthData.expenses.actual;
    monthData.currentMonthSavings = monthData.income.actual - monthData.expenses.actual;

    return { [targetMonthKey]: monthData };
}


/* ============================================================================
   4. LOCAL CACHE (instant load via localStorage)
   ----------------------------------------------------------------------------
   The whole point of this section: paint *something* on screen the instant
   the page loads, using whatever we last successfully fetched, instead of
   staring at "Loading..." until the network round-trip finishes. The real
   fetch still happens in the background and silently corrects the numbers
   once it resolves — see startDashboard() in section 5.
   ============================================================================ */

const BUDGET_CACHE_KEY = 'budgetDashboardCache_v1';

// Snapshots everything the dashboard needs to redraw itself — the month
// list, which month was selected, and both data stores — into localStorage.
// Called after every successful fetch (initial load, month switch,
// background sync) so the cache never falls too far out of date.
function saveDashboardCache() {
    try {
        localStorage.setItem(BUDGET_CACHE_KEY, JSON.stringify({
            months: Array.from(monthSelector.options).map(opt => opt.value),
            selectedMonth: monthSelector.value,
            budgetData: globalBudgetData,
            transactionsData: globalTransactionsData
        }));
    } catch (error) {
        // localStorage can throw (quota exceeded, private browsing, etc.) —
        // caching is a nice-to-have, so we swallow the error rather than
        // breaking the app over it.
        console.warn('Failed to save dashboard cache:', error);
    }
}

// Reads the cache (if any) and paints it immediately. Returns true/false so
// the caller (see the DOMContentLoaded listener in section 13) knows
// whether a cache render actually happened.
function hydrateFromCache() {
    let cache;
    try {
        const raw = localStorage.getItem(BUDGET_CACHE_KEY);
        if (!raw) return false; // nothing cached yet — first-ever visit
        cache = JSON.parse(raw);
    } catch (error) {
        console.warn('Failed to hydrate from cache:', error);
        return false;
    }
    if (!cache || !cache.months || !cache.budgetData || !cache.transactionsData) return false;

    Object.assign(globalBudgetData, cache.budgetData || {});
    Object.assign(globalTransactionsData, cache.transactionsData || {});

    const monthSelector = document.getElementById('monthSelector');
    monthSelector.innerHTML = '';
    cache.months.forEach(month => {
        const option = document.createElement('option');
        option.value = month;
        option.textContent = month;
        monthSelector.appendChild(option);
    });

    // IMPORTANT: cache.months is *every* month ever shown in the dropdown,
    // but globalBudgetData only has entries for months we actually fetched
    // transactions for. Those are two different lists! If we blindly picked
    // cache.months[0], we could try to render a month with no data and
    // crash. So: prefer whichever month was selected when we last saved,
    // but only if we actually have data for it — otherwise fall back to
    // the first month that does have data.
    const targetMonth = (cache.selectedMonth && globalBudgetData[cache.selectedMonth])
        ? cache.selectedMonth
        : Object.keys(globalBudgetData)[0];

    if (!targetMonth) {
        console.warn('Cache had no usable budget data to render.');
        return false;
    }

    renderMonthMenu(cache.months);
    monthSelector.value = targetMonth;
    renderAll(targetMonth);

    console.log('Hydrated dashboard from cache:', cache);
    return true;
}


/* ============================================================================
   5. DASHBOARD BOOTSTRAPPING & MONTH SWITCHING
   ----------------------------------------------------------------------------
   The three functions here cover the three ways the dashboard's on-screen
   month ever changes: first load (startDashboard -> initDashboard) and the
   user manually switching months (changeMonth). All three end up calling
   renderAll() once they have the data ready.
   ============================================================================ */

// Fetches the list of available months and populates the (real, hidden)
// <select> + the styled dropdown menu built on top of it. Also renders the
// first month once we know it. Runs after startDashboard() has already
// pulled in the current month's transactions.
async function initDashboard() {
    try {
        let months;
        if (GOOGLE_SCRIPT_URL) {
            months = await loadMonthNames();
        } else {
            // Fallback path for local testing without a backend configured.
            months = Object.keys(globalBudgetData).map(key => ({ label: key }));
        }

        const monthSelector = document.getElementById('monthSelector');
        // Remember what was selected BEFORE we wipe the dropdown — this is
        // whatever hydrateFromCache() (or a previous render) had picked.
        // Without this, rebuilding the options below always defaulted back
        // to the first month, undoing the "stay on my last-viewed month"
        // behavior every single page load.
        const previousSelection = monthSelector.value;
        monthSelector.innerHTML = '';

        months.forEach(month => {
            const option = document.createElement('option');
            option.value = month.label;
            option.textContent = month.label;
            monthSelector.appendChild(option);
        });

        const labels = months.map(month => month.label);
        renderMonthMenu(labels);

        if (labels.length > 0) {
            // Keep showing the month the user was already on, as long as it's
            // still a valid option — only fall back to the first month if we
            // have nothing better to go on (e.g. a brand new visit).
            const targetMonth = labels.includes(previousSelection) ? previousSelection : labels[0];

            monthSelector.value = targetMonth;
            renderMonthMenu(labels); // re-render so the "active" checkmark matches the selection

            // Avoid an unnecessary re-render if this exact month is already
            // showing correctly on screen (e.g. hydrateFromCache just painted it).
            if (targetMonth !== previousSelection || !globalBudgetData[targetMonth]) {
                renderAll(targetMonth);
            }
            saveDashboardCache();
        }
    } catch (error) {
        console.error('Could not load month names:', error);
        document.getElementById('month-trigger-label').textContent = 'Unavailable';
    }
}

// The very first thing that runs on page load (network-wise): fetches the
// current month's transactions, builds dashboard data from them, then hands
// off to initDashboard() to fill in the month picker.
async function startDashboard() {
    try {
        if (GOOGLE_SCRIPT_URL) {
            const rawData = await loadSpreadsheetData(null); // null -> defaults to "this month"

            console.log("Loaded raw data:", rawData);

            const currentYearAndMonth = new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });
            globalTransactionsData[currentYearAndMonth] = rawData.transactions || [];
            console.log("Stored transactions for", currentYearAndMonth, ":", globalTransactionsData[currentYearAndMonth]);
            Object.assign(globalBudgetData, buildBudgetData(rawData, currentYearAndMonth));
            console.log("Built globalBudgetData:", globalBudgetData);
            saveDashboardCache();
        } else {
            console.warn("No Sheet API URL. Using mock globalBudgetData.");
        }
        initDashboard();
    } catch (error) {
        console.error(error);
        document.getElementById('month-display').textContent = 'Could not load spreadsheet';
    }
}

// Tracks how many month-fetches are currently in flight. Used only for
// logging / optional future UI (e.g. a subtle spinner). It is intentionally
// NOT used as a hard lock — users can switch months freely while older
// requests finish. Stale responses are ignored via the
// "still the selected month?" check inside changeMonth / silentBackgroundSync.
let inFlightMonthFetches = 0;

async function changeMonth() {
    // Capture the month the user asked for *now*. Later, when the network
    // response arrives, we compare against the *current* selection so a
    // slow request for an old month never overwrites a newer one.
    const selectedMonth = document.getElementById('monthSelector').value;
    if (!selectedMonth) return;

    const monthDisplay = document.getElementById('month-display');

    // Stale-while-revalidate: if we already have this month's numbers in
    // memory (fetched earlier this session, or hydrated from localStorage
    // on page load), show them immediately — no "Calculating..." wait —
    // and then quietly refetch in the background to make sure they're
    // current. Only fall back to a loading state for months we've truly
    // never fetched before.
    const alreadyHaveData = Boolean(globalBudgetData[selectedMonth]);
    if (alreadyHaveData) {
        renderAll(selectedMonth);
        const txView = document.getElementById('transactions-view');
        if (txView && txView.style.display === 'block') {
            renderTransactionPage(selectedMonth);
        }
    } else {
        if (monthDisplay) monthDisplay.textContent = "Calculating...";
    }

    // Allow concurrent fetches. The user can switch months freely; we just
    // ignore results that no longer match the currently selected month.
    inFlightMonthFetches++;

    try {
        // (This triggers the URL split: ?year=2026&month=September)
        const rawData = await loadSpreadsheetData(selectedMonth);
        globalTransactionsData[selectedMonth] = rawData.transactions || [];

        // Rebuild the data object with the fresh, accurate numbers.
        Object.assign(globalBudgetData, buildBudgetData(rawData, selectedMonth));

        // Only redraw if the user hasn't since switched to yet another
        // month while this fetch was still in flight — otherwise we'd
        // overwrite whatever they're currently looking at with stale data.
        if (document.getElementById('monthSelector').value === selectedMonth) {
            renderAll(selectedMonth);
            const txView = document.getElementById('transactions-view');
            if (txView && txView.style.display === 'block') {
                renderTransactionPage(selectedMonth);
            }
            saveDashboardCache();
        } else {
            console.log(`Ignoring stale response for ${selectedMonth} (user is now on ${document.getElementById('monthSelector').value})`);
        }
    } catch (error) {
        console.error("Failed to fetch new month data:", error);
        // Only show the error if this month is still selected *and* we had
        // nothing cached for it. Otherwise leave the previous view alone.
        if (!alreadyHaveData && document.getElementById('monthSelector').value === selectedMonth) {
            if (monthDisplay) monthDisplay.textContent = "Error loading data";
        }
    } finally {
        inFlightMonthFetches = Math.max(0, inFlightMonthFetches - 1);
    }
}

// The single "repaint everything for this month" function. Every code path
// that changes which month is showing (initDashboard, changeMonth,
// hydrateFromCache, silentBackgroundSync) ends by calling this.
function renderAll(monthKey) {
    document.getElementById('month-display').textContent = monthKey;
    const data = globalBudgetData[monthKey];

    console.log(`Rendering data for ${monthKey}:`, data);

    renderMetricsSlider(data);
    renderLists(data);
}


/* ============================================================================
   6. BACKGROUND SYNC
   ----------------------------------------------------------------------------
   Uses the Page Visibility API so the dashboard quietly refreshes itself
   whenever the user tabs back in — e.g. they logged a transaction on their
   phone, then switched back to this tab — without any manual refresh.
   ============================================================================ */

async function silentBackgroundSync() {
    const selectedMonth = document.getElementById('monthSelector').value;
    if (!selectedMonth) return;

    // Still allow concurrent work; we just skip the noisy log when many
    // requests are already flying (e.g. rapid month switching).
    if (inFlightMonthFetches > 0) {
        console.log("Background sync deferred — user-initiated fetch(es) already in flight.");
        return;
    }

    inFlightMonthFetches++;
    console.log("Quietly refreshing data for", selectedMonth);

    try {
        // Same JSONP fetch changeMonth() uses — this function just doesn't
        // touch any "Calculating..." UI, so nothing visibly flickers.
        const rawData = await loadSpreadsheetData(selectedMonth);

        globalTransactionsData[selectedMonth] = rawData.transactions || [];
        Object.assign(globalBudgetData, buildBudgetData(rawData, selectedMonth));
        saveDashboardCache();

        // Only redraw if the user hasn't switched months while this was in flight.
        if (document.getElementById('monthSelector').value === selectedMonth) {
            renderAll(selectedMonth);

            const txView = document.getElementById('transactions-view');
            if (txView && txView.style.display === 'block') {
                renderTransactionPage(selectedMonth);
            }
        } else {
            console.log(`Ignoring stale background sync for ${selectedMonth}`);
        }
    } catch (error) {
        // Deliberately console.warn, not console.error, and no UI change:
        // a failed background sync just means "keep showing what we had."
        console.warn("Background sync failed, keeping existing data on screen:", error);
    } finally {
        inFlightMonthFetches = Math.max(0, inFlightMonthFetches - 1);
    }
}

// Fires every time the browser tab's visibility changes (switching tabs,
// minimizing the window, switching apps on mobile, etc.). We only care
// about the moment it becomes visible again.
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        silentBackgroundSync();
    }
});


/* ============================================================================
   7. MONTH PICKER UI
   ----------------------------------------------------------------------------
   The header's month selector is actually two things layered together: a
   real (visually hidden) <select id="monthSelector"> that holds the source
   of truth, and a custom-styled popup menu (#month-menu) built from it for
   a nicer look. Keeping a real <select> around means things like form
   submission or keyboard behavior still work even though it's invisible.
   ============================================================================ */

// Rebuilds the custom dropdown's list of month buttons from a plain array
// of month labels, marking whichever one matches the current <select> value
// as "active" (checkmark + highlight).
function renderMonthMenu(months) {
    const menu = document.getElementById('month-menu');
    const triggerLabel = document.getElementById('month-trigger-label');
    const selectedMonth = document.getElementById('monthSelector').value || months[0];

    menu.innerHTML = months.map(month => `
        <button class="month-option${month === selectedMonth ? ' active' : ''}"
                type="button" role="option" aria-selected="${month === selectedMonth}"
                data-month="${month}">
            <span>${month}</span>
            <span class="month-option-check" aria-hidden="true">✓</span>
        </button>
    `).join('');

    triggerLabel.textContent = selectedMonth || 'Select month';
}

function closeMonthMenu() {
    document.getElementById('month-menu').classList.remove('is-open');
    document.getElementById('month-trigger').setAttribute('aria-expanded', 'false');
}

// Cached DOM references — grabbed once at script load instead of re-querying
// the DOM every time an event fires. Safe here because this script tag is
// loaded at the bottom of <body>, after these elements already exist.
const monthTrigger = document.getElementById('month-trigger');
const monthMenu = document.getElementById('month-menu');
const monthSelector = document.getElementById('monthSelector');

// Clicking the visible "Select month ⌄" button toggles the popup open/shut.
monthTrigger.addEventListener('click', () => {
    const isOpen = monthMenu.classList.toggle('is-open');
    monthTrigger.setAttribute('aria-expanded', String(isOpen));
});

// Clicking a month inside the popup: sync it back onto the real <select>,
// re-render the menu (so the checkmark moves), close the popup, then
// actually go fetch/render that month via changeMonth().
monthMenu.addEventListener('click', event => {
    const option = event.target.closest('.month-option');
    if (!option) return;

    monthSelector.value = option.dataset.month;
    document.getElementById('month-trigger-label').textContent = option.dataset.month;

    // FIX: Grab the original, clean labels directly from the hidden selector
    const cleanLabels = Array.from(monthSelector.options).map(opt => opt.value);

    // Re-render the menu using the clean labels so the order never changes
    renderMonthMenu(cleanLabels);

    closeMonthMenu();
    changeMonth();
});

// Clicking anywhere outside the month picker closes the popup — a common
// "click outside to dismiss" pattern for custom dropdowns/menus.
document.addEventListener('click', event => {
    if (!event.target.closest('.month-picker')) closeMonthMenu();
});


/* ============================================================================
   8. METRICS SLIDER
   ----------------------------------------------------------------------------
   The "Current Balance / Current Month Savings / Starting Balance / Net
   Savings" carousel at the top of the dashboard. Built as a horizontal strip
   of slides that gets translateX()'d into view — a common CSS-carousel
   technique — plus a sneaky trick for looping seamlessly (see the comment
   near the "hidden clone slide" below).
   ============================================================================ */

// Rebuilds the slider's HTML from the given month's data and resets it to
// the first slide. Called every time renderAll() runs (i.e. every time the
// displayed month changes).
function renderMetricsSlider(data) {
    const slider = document.getElementById('metrics-slider');
    const dotsContainer = document.getElementById('slider-dots');

    const metrics = [
        { title: "Current Balance", value: data.endBalance, color: '' },
        { title: "Current Month Savings", value: data.currentMonthSavings, color: data.currentMonthSavings < 0 ? 'text-danger' : 'text-success' },
        { title: "Starting Balance", value: data.startBalance, color: '' },
        { title: "Net Savings", value: data.netSavings, color: data.netSavings < 0 ? 'text-danger' : 'text-success' }
    ];

    const totalDomSlides = metrics.length + 1; // +1 for the hidden clone slide (see below)
    const slideWidthPercentage = 100 / totalDomSlides;

    slider.style.width = `${totalDomSlides * 100}%`;

    slider.innerHTML = '';
    dotsContainer.innerHTML = '';

    metrics.forEach((metric, index) => {
        const sign = metric.value < 0 ? '-' : (metric.value > 0 && metric.title === "Net Savings" ? '+' : '');
        slider.innerHTML += `
            <div class="slide ${index === 0 ? 'active' : ''}" style="width: ${slideWidthPercentage}%">
                <h3>${metric.title}</h3>
                <h2 class="${metric.color}">${formatCurrency(metric.value)}</h2>
            </div>
        `;
        dotsContainer.innerHTML += `<div class="dot ${index === 0 ? 'active' : ''}" onclick="goToSlide(${index})"></div>`;
    });

    // Loop trick: clone the first slide and tack it on the end (without the
    // "active" class). When advancePulse() reaches this clone, it *looks*
    // like the carousel is continuing forward past the last real slide —
    // then goToSlide(0, false) instantly (no animation) snaps back to the
    // real first slide behind the scenes. The user never sees the reset.
    slider.insertAdjacentHTML('beforeend', slider.firstElementChild.outerHTML.replace(' active', ''));

    goToSlide(0); // Reset to first slide on month change
}

// Moves the slider to a given slide index. `animate = false` is used only
// for the invisible "snap back to slide 0" jump described above.
function goToSlide(index, animate = true) {
    const slider = document.getElementById('metrics-slider');
    const slides = document.querySelectorAll('.slide');
    const dots = document.querySelectorAll('.dot');
    const metricsCount = document.getElementById('metrics-count');

    const totalMetrics = dots.length; // real slide count (the clone has no dot)
    const stepPercentage = 100 / (totalMetrics + 1); // +1 for the hidden clone slide

    currentSlide = index;
    slider.classList.toggle('no-transition', !animate); // disables the CSS transition for instant jumps
    slider.style.transform = `translateX(-${currentSlide * stepPercentage}%)`;

    const activeSlide = currentSlide % totalMetrics; // wraps back to slide 0 once we pass the last real one
    
    if (metricsCount) {
        const current = String(activeSlide + 1).padStart(2, '0');
        const total = String(totalMetrics).padStart(2, '0');
        metricsCount.textContent = `${current} / ${total}`;
    }

    slides.forEach((s, i) => s.classList.toggle('active', i === activeSlide));
    dots.forEach((d, i) => d.classList.toggle('active', i === currentSlide));
}

document.getElementById('prev-btn').addEventListener('click', () => {
    goToSlide(Math.max(0, currentSlide - 1));
});
document.getElementById('next-btn').addEventListener('click', () => {
    advancePulse();
});

// Pause the auto-advance timer while the user is actively interacting with
// the slider (mouse hover on desktop, touch on mobile) so it doesn't jump
// to the next slide mid-interaction.
const slider = document.getElementById('metrics-slider');
slider.addEventListener('mouseenter', () => isPaused = true);
slider.addEventListener('mouseleave', () => isPaused = false);
slider.addEventListener('touchstart', () => isPaused = true, { passive: true });
slider.addEventListener('touchend', () => isPaused = false, { passive: true });
console.log("Slider hover/touch pause logic initialized.");
console.log("Mouse is hovering over the slider:", isPaused);

// --- Swipe support ---
// touchstart/touchend alone (the old listeners) only ever paused
// auto-advance — they never actually read which way the finger moved, so
// swiping never changed slides. These three listeners track the finger's
// horizontal position from touch-down to touch-up and, if it moved far
// enough, treat it as a "swipe left" (next slide) or "swipe right"
// (previous slide) — the same gesture a native carousel app would expect.
let swipeStartX = 0;
let swipeDeltaX = 0;
const SWIPE_THRESHOLD_PX = 40; // how far a touch has to travel to count as a swipe, not a tap
 
slider.addEventListener('touchstart', event => {
    isPaused = true; // still pause auto-advance while a finger is down
    swipeStartX = event.touches[0].clientX;
    swipeDeltaX = 0;
}, { passive: true });
 
slider.addEventListener('touchmove', event => {
    swipeDeltaX = event.touches[0].clientX - swipeStartX;
}, { passive: true });
 
slider.addEventListener('touchend', () => {
    isPaused = false;
 
    if (Math.abs(swipeDeltaX) > SWIPE_THRESHOLD_PX) {
        if (swipeDeltaX < 0) {
            // Finger moved left -> reveal the slide to the right -> next slide.
            advancePulse();
        } else {
            // Finger moved right -> reveal the slide to the left -> previous slide.
            goToSlide(Math.max(0, currentSlide - 1));
        }
    }
    // A short tap (delta below the threshold) intentionally does nothing —
    // that's what the dots and prev/next buttons are for.
 
    swipeStartX = 0;
    swipeDeltaX = 0;
}, { passive: true });


// Advances to the next slide, using the loop trick described in
// renderMetricsSlider() above: when we land on the cloned slide, silently
// (no animation) snap back to the real slide 0 half a second later.
function advancePulse() {
    const totalMetrics = document.querySelectorAll('.dot').length;
    const nextSlide = currentSlide + 1;
    goToSlide(nextSlide);

    if (nextSlide === totalMetrics) {
        window.setTimeout(() => goToSlide(0, false), 500);
    }
}

// Auto-advance the carousel every 10 seconds, unless the user is
// hovering/touching it right now.
window.setInterval(() => {
    if (!isPaused) advancePulse();
}, 10000);


/* ============================================================================
   9. EXPENSE & INCOME LISTS
   ----------------------------------------------------------------------------
   The two category breakdown lists below the slider. Both lists use the
   same visual pattern (name on the left, actual + planned amount on the
   right), just with the "is this good or bad" color logic flipped between
   them — overspending is bad for expenses, but under-earning is bad for
   income, so the comparison direction differs.
   ============================================================================ */

function renderLists(data) {
    // Expenses: red if you spent MORE than planned (planned - actual < 0).
    document.getElementById('expense-summary').textContent =
        `Act: ${formatCurrency(data.expenses.actual)} / Plan: ${formatCurrency(data.expenses.planned)}`;
    document.getElementById('expense-list').innerHTML = data.expenses.categories.map(item => {
        const diffColor = (item.planned - item.actual) < 0 ? 'text-danger' : 'text-success';
        return `
            <div class="list-item">
                <span>${item.name}</span>
                <div class="item-meta">
                    <span class="item-actual ${diffColor}">${formatCurrency(item.actual)}</span>
                    <span class="item-plan">Plan: ${formatCurrency(item.planned)}</span>
                </div>
            </div>`;
    }).join('');

    // Income: red if you earned LESS than planned (actual - planned < 0) —
    // the opposite comparison direction from expenses, on purpose.
    document.getElementById('income-summary').textContent =
        `Act: ${formatCurrency(data.income.actual)} / Plan: ${formatCurrency(data.income.planned)}`;
    document.getElementById('income-list').innerHTML = data.income.categories.map(item => {
        const diffColor = (item.actual - item.planned) < 0 ? 'text-danger' : 'text-success';
        return `
            <div class="list-item">
                <span>${item.name}</span>
                <div class="item-meta">
                    <span class="item-actual ${diffColor}">${formatCurrency(item.actual)}</span>
                    <span class="item-plan">Plan: ${formatCurrency(item.planned)}</span>
                </div>
            </div>`;
    }).join('');
}


/* ============================================================================
   10. TRANSACTION HISTORY PAGE
   ----------------------------------------------------------------------------
   Unlike the summary lists above (which show rolled-up category totals),
   this renders every individual transaction row for a month — this is why
   it reads from globalTransactionsData (raw rows) rather than
   globalBudgetData (computed totals).
   ============================================================================ */

function renderTransactionPage(monthKey) {
    monthKey = monthKey || document.getElementById('monthSelector').value;
    const listContainer = document.getElementById('transaction-history-list');
    const transactions = globalTransactionsData[monthKey] || [];

    if (transactions.length === 0) {
        listContainer.innerHTML = `<p class="text-muted">No transactions for ${monthKey}.</p>`;
        return;
    }

    listContainer.innerHTML = transactions.map((tx, index) => {
        const isExpense = tx.category !== 'Income';
        const amountColor = isExpense ? 'text-danger' : 'text-success';
        const justDay = tx.date.split('/')[2]; // matches whatever date format the sheet uses, e.g. "MM/DD/YYYY"

        return `
            <div class="list-item">
                <div class="d-flex align-items-center gap-3">
                    <div class="glass-badge text-center p-2">
                        <span class="d-none d-md-block text-muted" style="font-size: 0.75rem;">${tx.date}</span>
                        <span class="d-md-none fw-bold">${justDay}</span>
                    </div>
                    <div>
                        <span class="item-name d-block">${tx.store}</span>
                        <span class="item-plan">${tx.category}</span>
                    </div>
                </div>
                <div class="item-stats text-end">
                    <span class="item-actual ${amountColor}">${formatCurrency(tx.amount)}</span>
                    <!-- <button class="btn btn-link text-danger p-0 mt-1" style="font-size: 0.8rem; text-decoration: none;" onclick="deleteMockTx(${index}, '${monthKey}')">Delete</button> -->
                </div>
            </div>
        `;
    }).join('');
}

// Placeholder delete handler — the actual delete button is commented out in
// the template above, so this only runs if/when that's wired back up. It
// only shows a confirm/alert; it doesn't touch the backend or any data.
function deleteMockTx(id) {
    if (confirm("Delete this transaction?")) {
        alert(`Transaction ${id} deleted (UI simulation only).`);
    }
}


/* ============================================================================
   11. PAGE NAVIGATION
   ----------------------------------------------------------------------------
   This is a single-page app in disguise: "Overview" and "Transactions" are
   both always in the DOM, and clicking a nav link just toggles which
   sections are display:none vs visible — no real page load happens.
   ============================================================================ */

document.querySelectorAll('.nav-links a').forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault(); // these are <a href="#">, so stop the browser from jumping to top

        // Move the "active" styling to whichever link was clicked.
        document.querySelectorAll('.nav-links a').forEach(l => l.classList.remove('active'));
        e.target.classList.add('active');
        document.querySelectorAll('.nav-links a').forEach(l => l.removeAttribute('aria-current'));
        e.currentTarget.setAttribute('aria-current', 'page');
        closeMobileMenu();

        // Naive but effective: figure out which "page" this is by the link
        // text rather than a data-attribute or routing table.
        const isTransactions = e.currentTarget.textContent.includes('Transactions');

        // Show/hide the Overview page's sections vs. the Transactions page.
        document.querySelector('.interactive-core').style.display = isTransactions ? 'none' : 'block';
        document.querySelector('.details-flow').style.display = isTransactions ? 'none' : 'grid';
        document.getElementById('receipt-upload-view').style.display = isTransactions ? 'none' : 'block';

        const txView = document.getElementById('transactions-view');
        txView.style.display = isTransactions ? 'block' : 'none';

        if (isTransactions) renderTransactionPage();
    });
});

const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
const primaryNavigation = document.getElementById('primary-navigation');

function closeMobileMenu() {
    primaryNavigation.classList.remove('is-open');
    mobileMenuToggle.setAttribute('aria-expanded', 'false');
    mobileMenuToggle.setAttribute('aria-label', 'Open navigation menu');
}

// Clicking the brand/logo acts as a shortcut back to the Overview tab —
// implemented by just re-clicking the first nav link programmatically,
// reusing all the logic above instead of duplicating it.
document.getElementById('brand-home').addEventListener('click', () => {
    const overviewLink = document.querySelector('.nav-links a');
    overviewLink.click();
});

// The hamburger button shown on narrow/mobile layouts (see the CSS media
// query) that reveals the nav links as a dropdown instead of a sidebar.
mobileMenuToggle.addEventListener('click', () => {
    const isOpen = primaryNavigation.classList.toggle('is-open');
    mobileMenuToggle.setAttribute('aria-expanded', String(isOpen));
    mobileMenuToggle.setAttribute('aria-label', isOpen ? 'Close navigation menu' : 'Open navigation menu');
});

// Tapping/clicking anywhere outside the open mobile menu closes it — same
// "click outside to dismiss" pattern used for the month picker above.
// The closest('#mobile-menu-toggle') check stops this from immediately
// re-closing the menu the instant the hamburger button's own click
// listener just opened it (that click event bubbles up to this listener too).
document.addEventListener('click', event => {
    if (!primaryNavigation.classList.contains('is-open')) return;
    if (event.target.closest('#primary-navigation') || event.target.closest('#mobile-menu-toggle')) return;
    closeMobileMenu();
});


/* ============================================================================
   12. RECEIPT UPLOAD
   ----------------------------------------------------------------------------
   Lets the user attach a photo of a receipt to their records. Two input
   paths feed the same handler: a regular file picker, and a camera capture
   input (capture="environment" in the HTML opens the phone's back camera
   directly). Drag-and-drop onto the dropzone is a third path into the same
   function.
   ============================================================================ */

const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB

// Entry point for all three ways a file can be selected (picker, camera,
// drag-and-drop). Shows an image preview, then kicks off the actual upload.
function handleReceiptSelected(file) {
    if (!file) return;

    if (file.size > MAX_FILE_SIZE) {
        alert('File is too large. Please select a file smaller than 15MB.');
        return;
    }

    const preview = document.getElementById('receipt-preview');
    preview.replaceChildren(); // clears any previous preview content

    if (file.type.startsWith('image/')) {
        const image = document.createElement('img');

        // createObjectURL gives us an instant local preview without
        // needing to wait for any upload — the image is shown straight
        // from the file the user picked, before any network call happens.
        image.src = URL.createObjectURL(file);
        image.alt = 'Receipt preview';
        image.className = 'img-fluid rounded';
        image.style.maxWidth = '100%';
        image.style.maxHeight = '400px';

        preview.appendChild(image);
    } else {
        preview.textContent = 'Please select an image receipt';
    }
    uploadReceipt(file);
}

// Converts a File object into a base64 data URL string — needed because
// the Apps Script backend expects base64 text in a JSON POST body, not a
// binary multipart upload.
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;

        reader.readAsDataURL(file);
    });
}

// Uploads the receipt to the backend. Unlike the JSONP GET requests used
// elsewhere in this file, this is a real fetch() POST — uploads don't need
// to read a cross-origin *response* body in the same restrictive way, and
// Apps Script accepts POST bodies directly.
async function uploadReceipt(file) {
    const preview = document.getElementById('receipt-preview');

    try {
        preview.textContent = 'Preparing receipt...';

        const dataUrl = await fileToBase64(file);
        // data URLs look like "data:image/png;base64,AAAA..." — split off
        // everything after the comma to get just the base64 payload.
        const base64Data = dataUrl.split(',')[1];

        preview.textContent = 'Uploading receipt...';

        const response = await fetch(GOOGLE_SCRIPT_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain;charset=utf-8' // avoids a CORS preflight request
            },
            body: JSON.stringify({
                fileName: file.name,
                mimeType: file.type,
                data: base64Data
            })
        });

        const result = await response.json();

        if (!result.success) {
            throw new Error(result.message || 'Upload failed');
        }

        preview.textContent = `Uploaded: ${result.fileName}`;

        // Clear the preview and reset both file inputs after a short delay,
        // so the user gets to see the success message before it disappears.
        setTimeout(() => {
            preview.replaceChildren();
            document.getElementById('receipt-file').value = '';
            document.getElementById('receipt-camera').value = '';
        }, 1500);
    } catch (error) {
        console.error('Receipt upload failed:', error);
        preview.textContent = 'Upload failed. Please try again.';
    }
}

document.getElementById('receipt-file').addEventListener('change', event => {
    handleReceiptSelected(event.target.files[0]);
});

document.getElementById('receipt-camera').addEventListener('change', event => {
    handleReceiptSelected(event.target.files[0]);
});

const receiptDropzone = document.getElementById('receipt-dropzone');
const receiptFileInput = document.getElementById('receipt-file');

// Drag-and-drop needs preventDefault() on dragenter/dragover, or the
// browser's default behavior (usually opening the file) takes over instead
// of letting our 'drop' handler run.
['dragenter', 'dragover'].forEach(eventName => {
    receiptDropzone.addEventListener(eventName, event => {
        event.preventDefault();
        receiptDropzone.classList.add('is-dragging'); // visual feedback while dragging over
    });
});

['dragleave', 'drop'].forEach(eventName => {
    receiptDropzone.addEventListener(eventName, event => {
        event.preventDefault();
        receiptDropzone.classList.remove('is-dragging');
    });
});

receiptDropzone.addEventListener('drop', event => {
    handleReceiptSelected(event.dataTransfer.files[0]);
});

// Clicking anywhere on the dropzone (except directly on one of the
// "Browse files"/"Use camera" <label> buttons, which already trigger their
// linked <input> natively) opens the file picker too — makes the whole box
// feel clickable, not just the small label buttons.
receiptDropzone.addEventListener('click', event => {
    if (!event.target.closest('label')) {
        receiptFileInput.click();
    }
});

// Keyboard accessibility: Enter or Space on the focused dropzone also opens
// the file picker, matching how a native button would behave.
receiptDropzone.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        receiptFileInput.click();
    }
});


/* ============================================================================
   13. STARTUP
   ----------------------------------------------------------------------------
   Everything above this point defined functions and attached event
   listeners — none of it actually fetched data or painted the dashboard.
   These two DOMContentLoaded listeners are what actually kick the app into
   motion once the page's HTML has finished loading.
   ============================================================================ */

// Small header widget: shows today's day-of-month in the brand mark.
// Independent of the rest of the dashboard, so it's its own listener.
function updateBrandDate() {
    const brandDate = document.getElementById('brand-date');
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    brandDate.textContent = day;
    console.log("Brand date updated to:", day);
}
document.addEventListener('DOMContentLoaded', updateBrandDate);

// The real startup sequence:
//   1. hydrateFromCache() — paint instantly from whatever we cached last
//      time (see section 4), if anything's there.
//   2. startDashboard() — regardless of whether the cache hit, always fetch
//      fresh data in the background and silently correct the display once
//      it arrives (see section 5).
document.addEventListener('DOMContentLoaded', () => {
    hydrateFromCache();
    startDashboard();
});