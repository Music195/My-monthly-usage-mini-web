// 1. Mock Data (Based on your Google Sheets extracts)
const globalBudgetData = {};
const globalTransactionsData = {}; // raw per-month transaction data, keyed by "Month Year" (e.g., "September 2026")

const GOOGLE_SCRIPT_URL=
    'https://script.google.com/macros/s/AKfycbz7bQN377P10T0zuKUNuD4CDzqoXsg-VwUh9s-9Iwb-4tMUAbWNJzYgaSq3lpXag0lT/exec';

function loadMonthNames() {
    return new Promise((resolve, reject) => {
        const callbackName = `monthCallback_${Date.now()}`;

        window[callbackName] = result => {
            delete window[callbackName];
            script.remove();

            // 🔍 DEBUG LINE:
            console.log("RAW BACKEND RESULT:", result);

            if (!result.success) {
                reject(new Error('Could not load month names'));
                return;
            }

            resolve(result.months);
        };

        const script = document.createElement('script');

        script.src =
            `${GOOGLE_SCRIPT_URL}?action=months&callback=${callbackName}`;

        script.onerror = () => {
            delete window[callbackName];
            script.remove();
            reject(new Error('Could not connect to Google Sheets'));
        };

        document.body.appendChild(script);
    });
}


function loadSpreadsheetData(yearAndMonth) {
    return new Promise((resolve, reject) => {
        const callbackName = `sheetCallback_${Date.now()}`;


        window[callbackName] = result => {
            delete window[callbackName];
            script.remove();

            // 🔍 DEBUG LINE:
            console.log("RAW BACKEND RESULT:", result);

            if (!result.success) {
                reject(new Error('Could not load sheet data'));
                return;
            }

            resolve(result);
        };

        const script = document.createElement('script');

        const [targetMonth, targetYear] = yearAndMonth ? yearAndMonth.split(' ') : [new Date().toLocaleString('en-US', { month: 'long' }), new Date().getFullYear().toString()];

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

//Convert sheet transactions into dashboard data
function buildBudgetData(rawData, targetMonthKey) {
    const transactions = rawData.transactions || [];
    const netSavings = rawData.netSaving || 0;
    const startingBalance = rawData.startingBalance || 0;

    console.log("Building budget data from transactions:", transactions);
    console.log("Starting balance:", startingBalance, "Net savings:", netSavings);

    const monthData = {
        startBalance: startingBalance,
        endBalance: 0,
        netSavings: netSavings,
        expenses: { planned: 0, actual: 0, categories: [] },
        income: { planned: 0, actual: 0, categories: [] }
    };

    transactions.forEach(transaction => {
        if (!transaction.date.includes('/')) {
            console.warn(`Skipping transaction with invalid date format: ${transaction.date}`);
            return;
        }

        const target = transaction.category === 'Income'
            ? monthData.income
            : monthData.expenses;

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

    return { [targetMonthKey]: monthData };
}


const formatCurrency = (num) => `¥${Math.abs(num).toLocaleString()}`;
let currentSlide = 0;

// 2. Initialization & Month Toggling
async function initDashboard() {
    try {
        let months;
        // Only fetch months if the URL is provided, otherwise extract from mock data
        if (GOOGLE_SCRIPT_URL) {
            months = await loadMonthNames();
        } else {
            months = Object.keys(globalBudgetData).map(key => ({ label: key }));
        }

        const monthSelector = document.getElementById('monthSelector');
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
            monthSelector.value = labels[0];
            renderMonthMenu(labels);
            renderAll(labels[0]);
        }
    } catch (error) {
        console.error('Could not load month names:', error);
        document.getElementById('month-trigger-label').textContent = 'Unavailable';
    }
}


//Initialize the dashboard from the sheet
async function startDashboard() {
    try {
        // Only fetch if the URL is provided
        if (GOOGLE_SCRIPT_URL) {

            const rawData = await loadSpreadsheetData(null); // Fetch all months initially

            console.log("Loaded raw data:", rawData);
            
            const currentYearAndMonth = new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });
            globalTransactionsData[currentYearAndMonth] = rawData.transactions || []; 
            console.log("Stored transactions for", currentYearAndMonth, ":", globalTransactionsData[currentYearAndMonth]);
            Object.assign(globalBudgetData, buildBudgetData(rawData, currentYearAndMonth));
            console.log("Built globalBudgetData:", globalBudgetData);
        } else {
            console.warn("No Sheet API URL. Using mock globalBudgetData.");
        }
        initDashboard();
    } catch (error) {
        console.error(error);
        document.getElementById('month-display').textContent = 'Could not load spreadsheet';
    }
}

// Start the dashboard once the DOM is fully loaded
document.addEventListener('DOMContentLoaded', startDashboard);


// --- Month Menu Logic ---

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

const monthTrigger = document.getElementById('month-trigger');
const monthMenu = document.getElementById('month-menu');
const monthSelector = document.getElementById('monthSelector');

monthTrigger.addEventListener('click', () => {
    const isOpen = monthMenu.classList.toggle('is-open');
    monthTrigger.setAttribute('aria-expanded', String(isOpen));
});

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

document.addEventListener('click', event => {
    if (!event.target.closest('.month-picker')) closeMonthMenu();
});

// changeMonth is for when the user selects a new month from the dropdown. It fetches fresh data for that month and updates the dashboard.

let isFetchingMonthData = false;

async function changeMonth() {

    if (isFetchingMonthData) {
        console.warn("Already fetching month data. Please wait.");
        return;
    }

    isFetchingMonthData = true;

    // 1. Get the newly selected month (e.g., "September 2026")
    const selectedMonth = document.getElementById('monthSelector').value;
    
    // Let the user know the backend is calculating and visually disable the trigger
    const monthDisplay = document.getElementById('month-display');
    if (monthDisplay) monthDisplay.textContent = "Calculating...";

    const monthTrigger = document.getElementById('month-trigger');
    if (monthTrigger) monthTrigger.style.pointerEvents = 'none'; // Prevents rapid clicking

    try {
        // 2. Ask Google for the fresh data for THIS specific month!
        // (This triggers the URL split: ?year=2026&month=September)
        const rawData = await loadSpreadsheetData(selectedMonth);
        globalTransactionsData[selectedMonth] = rawData.transactions || [];

        // 3. Rebuild your data object with the new, accurate starting balance
        Object.assign(globalBudgetData, buildBudgetData(rawData, selectedMonth));

        // 4. Render the updated numbers on the screen!
        if (globalBudgetData[selectedMonth]) {
        renderAll(selectedMonth);
        const txView = document.getElementById('transactions-view'); // fixed: was 'transaction-view'
        if (txView && txView.style.display === 'block') {
            renderTransactionPage(selectedMonth);
        }
}
    } catch (error) {
        console.error("Failed to fetch new month data:", error);
        document.getElementById('month-display').textContent = "Error loading data";
    } finally {
        isFetchingMonthData = false;
        if (monthTrigger) monthTrigger.style.pointerEvents = 'auto';
    }
}

// Render all components for the selected month
function renderAll(monthKey) {
    document.getElementById('month-display').textContent = monthKey;
    const data = globalBudgetData[monthKey];

    console.log(`Rendering data for ${monthKey}:`, data);
    
    renderMetricsSlider(data);
    renderLists(data);
}

// --- End of Month Menu Logic ---


//  Slider Logic
function renderMetricsSlider(data) {
    const slider = document.getElementById('metrics-slider');
    const dotsContainer = document.getElementById('slider-dots');
    
    const metrics = [
        { title: "Starting Balance", value: data.startBalance, color: '' },
        { title: "Ending Balance", value: data.endBalance, color: '' },
        { title: "Net Savings", value: data.netSavings, color: data.netSavings < 0 ? 'text-danger' : 'text-success' }
    ];
    
    slider.innerHTML = ''; dotsContainer.innerHTML = '';
    
    metrics.forEach((metric, index) => {
        const sign = metric.value < 0 ? '-' : (metric.value > 0 && metric.title === "Net Savings" ? '+' : '');
        slider.innerHTML += `
            <div class="slide ${index === 0 ? 'active' : ''}">
                <h3>${metric.title}</h3>
                <h2 class="${metric.color}">${sign}${formatCurrency(metric.value)}</h2>
            </div>
        `;
        dotsContainer.innerHTML += `<div class="dot ${index === 0 ? 'active' : ''}" onclick="goToSlide(${index})"></div>`;
    });

    // Add a hidden fourth slide so the forward loop never visibly reverses.
    slider.insertAdjacentHTML('beforeend', slider.firstElementChild.outerHTML.replace(' active', ''));
    
    goToSlide(0); // Reset to first slide on month change
}

function goToSlide(index, animate = true) {
    const slider = document.getElementById('metrics-slider');
    const slides = document.querySelectorAll('.slide');
    const dots = document.querySelectorAll('.dot');
    const metricsCount = document.getElementById('metrics-count');
    
    currentSlide = index;
    slider.classList.toggle('no-transition', !animate);
    slider.style.transform = `translateX(-${currentSlide * 25}%)`;
    if (metricsCount) metricsCount.textContent = `0${(currentSlide % 3) + 1} / 03`;
    
    const activeSlide = currentSlide % 3;
    slides.forEach((s, i) => s.classList.toggle('active', i === activeSlide));
    dots.forEach((d, i) => d.classList.toggle('active', i === currentSlide));
}

document.getElementById('prev-btn').addEventListener('click', () => {
    goToSlide(Math.max(0, currentSlide - 1));
});
document.getElementById('next-btn').addEventListener('click', () => {
    advancePulse();
});

// Rotate the monthly pulse automatically every four seconds.
function advancePulse() {
    const nextSlide = currentSlide + 1;
    goToSlide(nextSlide);

    if (nextSlide === 3) {
        window.setTimeout(() => goToSlide(0, false), 500);
    }
}

window.setInterval(advancePulse, 4000);

// 4. Data Lists Logic
function renderLists(data) {
    // Expenses
    document.getElementById('expense-summary').textContent = `Act: ${formatCurrency(data.expenses.actual)} / Plan: ${formatCurrency(data.expenses.planned)}`;
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

    // Income
    document.getElementById('income-summary').textContent = `Act: ${formatCurrency(data.income.actual)} / Plan: ${formatCurrency(data.income.planned)}`;
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


// --- TRANSACTION RENDERING ---
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
        const justDay = tx.date.split('/')[2];

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

// Dummy delete function for UI testing
function deleteMockTx(id) {
    if(confirm("Delete this transaction?")) {
        alert(`Transaction ${id} deleted (UI simulation only).`);
    }
}

// --- PAGE NAVIGATION ---
document.querySelectorAll('.nav-links a').forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        
        // Update active class
        document.querySelectorAll('.nav-links a').forEach(l => l.classList.remove('active'));
        e.target.classList.add('active');
        document.querySelectorAll('.nav-links a').forEach(l => l.removeAttribute('aria-current'));
        e.currentTarget.setAttribute('aria-current', 'page');
        closeMobileMenu();
        
        const isTransactions = e.currentTarget.textContent.includes('Transactions');
        
        // Toggle view visibility
        document.querySelector('.interactive-core').style.display = isTransactions ? 'none' : 'block';
        document.querySelector('.details-flow').style.display = isTransactions ? 'none' : 'grid';
        document.getElementById('receipt-upload-view').style.display = isTransactions ? 'none' : 'block';
        
        const txView = document.getElementById('transactions-view');
        txView.style.display = isTransactions ? 'block' : 'none';
        
        if(isTransactions) renderTransactionPage();
    });
});

const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
const primaryNavigation = document.getElementById('primary-navigation');

function closeMobileMenu() {
    primaryNavigation.classList.remove('is-open');
    mobileMenuToggle.setAttribute('aria-expanded', 'false');
    mobileMenuToggle.setAttribute('aria-label', 'Open navigation menu');
}

document.getElementById('brand-home').addEventListener('click', () => {
    const overviewLink = document.querySelector('.nav-links a');
    overviewLink.click();
});

mobileMenuToggle.addEventListener('click', () => {
    const isOpen = primaryNavigation.classList.toggle('is-open');
    mobileMenuToggle.setAttribute('aria-expanded', String(isOpen));
    mobileMenuToggle.setAttribute('aria-label', isOpen ? 'Close navigation menu' : 'Open navigation menu');
});

// --- RECEIPT UPLOAD HANDLING ---
// Receipt Preview Logic

const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB

function handleReceiptSelected(file) {
    if (!file) return;

    if (file.size > MAX_FILE_SIZE) {
        alert('File is too large. Please select a file smaller than 15MB.');
        return;
    }

    const preview = document.getElementById('receipt-preview');
    preview.replaceChildren();

    if (file.type.startsWith('image/')) {
        const image = document.createElement('img');

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

// Receipt Upload Logic

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;

        reader.readAsDataURL(file);
    });
}

async function uploadReceipt(file) {
    const preview = document.getElementById('receipt-preview');

    try {
        preview.textContent = 'Preparing receipt...';

        const dataUrl = await fileToBase64(file);
        const base64Data = dataUrl.split(',')[1];

        preview.textContent = 'Uploading receipt...';

        const response = await fetch(GOOGLE_SCRIPT_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain;charset=utf-8'
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

['dragenter', 'dragover'].forEach(eventName => {
    receiptDropzone.addEventListener(eventName, event => {
        event.preventDefault();
        receiptDropzone.classList.add('is-dragging');
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

receiptDropzone.addEventListener('click', event => {
    if (!event.target.closest('label')) {
        receiptFileInput.click();
    }
});

receiptDropzone.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        receiptFileInput.click();
    }
});


