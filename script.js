
// 1. Dynamic Page Content Loading (No Reload)
function loadPage(pageId) {
    // Hide all sections
    const sections = document.querySelectorAll('.content-section');
    sections.forEach(section => {
        section.classList.add('d-none');
        section.classList.remove('active-page');
    });

    // Show target section with animation
    const targetSection = document.getElementById(pageId);
    if (targetSection) {
        targetSection.classList.remove('d-none');

        // Re-trigger CSS animation
        targetSection.classList.remove('fade-in');
        void targetSection.offsetWidth; // Trigger reflow
        targetSection.classList.add('fade-in');
        targetSection.classList.add('active-page');
    }
}

// 2. Dark Mode Toggle
const darkModeToggle = document.getElementById('darkModeToggle');
darkModeToggle.addEventListener('click', () => {
    document.body.classList.toggle('dark-mode');

    // Update chart colors if analytics page is viewed
    updateChartTheme();
});

// Function to dynamically update chart text colors on theme switch
function updateChartTheme() {
    const isDark = document.body.classList.contains('dark-mode');
    const color = isDark ? '#e0e0e0' : '#212529';

    myChart.options.plugins.legend.labels.color = color;
    myChart.options.scales.x.ticks.color = color;
    myChart.options.scales.y.ticks.color = color;
    myChart.update();
}

// --- NEW SPREADSHEET DATA & VISUALIZATION LOGIC ---

// Require Google Apps Script URL here!
const SPREADSHEET_API_URL = "https://script.google.com/macros/s/AKfycbwyNoxt239cTmhwOjqVAhkva9hhCR0rain07DewrY8Zzc68Y9s0hcqcIwS1gA-VVpx1/exec";

const MONTH_ORDER = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

function compareMonthLabels(a, b) {
    const parsedA = Date.parse(a);
    const parsedB = Date.parse(b);

    if (!Number.isNaN(parsedA) && !Number.isNaN(parsedB)) {
        return parsedA - parsedB;
    }

    const monthA = MONTH_ORDER.indexOf(a);
    const monthB = MONTH_ORDER.indexOf(b);

    if (monthA !== -1 || monthB !== -1) {
        const safeMonthA = monthA === -1 ? Number.POSITIVE_INFINITY : monthA;
        const safeMonthB = monthB === -1 ? Number.POSITIVE_INFINITY : monthB;
        return safeMonthA - safeMonthB || a.localeCompare(b);
    }

    return a.localeCompare(b);
}

// 1. Fetch the live data from Google Sheets
// A global variable to store the data for all months so we don't have to re-fetch when toggling
let globalBudgetData = {}; 

async function fetchLiveBudget() {
    const container = document.getElementById('top-balances-container');
    const monthSelector = document.getElementById('monthSelector');
    if (!container) return;

    container.innerHTML = '<div class="col-12"><p class="text-muted">Loading live data from Google Sheets...</p></div>';

    try {
        const response = await fetch(SPREADSHEET_API_URL);
        globalBudgetData = await response.json(); 

        // 1. Populate the Dropdown menu with the months found in the spreadsheet
        monthSelector.innerHTML = ''; 
        const availableMonths = Object.keys(globalBudgetData).sort(compareMonthLabels); // e.g., ["April", "May"]
        
        availableMonths.forEach(month => {
            const option = document.createElement('option');
            option.value = month;
            option.textContent = month;
            monthSelector.appendChild(option);
        });

        // 2. Render the first available month automatically
        if (availableMonths.length > 0) {
            // Select the most recent month (the last one in the array)
            const latestMonth = availableMonths[availableMonths.length - 1];
            monthSelector.value = latestMonth;
            renderSummaryTable(globalBudgetData[latestMonth]);
        } else {
            container.innerHTML = '<div class="col-12"><p class="text-warning">No Summary tabs found in spreadsheet.</p></div>';
        }
        
    } catch (error) {
        console.error("Error fetching live data:", error);
        container.innerHTML = '<div class="col-12"><p class="text-danger fw-bold">Failed to connect to the spreadsheet API.</p></div>';
    }
}

// Function triggered whenever the dropdown menu changes
function changeMonth() {
    const selectedMonth = document.getElementById('monthSelector').value;
    
    // Look up the data for the chosen month and re-draw the tables
    if (globalBudgetData[selectedMonth]) {
        renderSummaryTable(globalBudgetData[selectedMonth]);
    }
}

// 2. Render the visual data flows
function renderSummaryTable(data) {
    const expensesBody = document.getElementById('expenses-body');
    const incomeBody = document.getElementById('income-body');
    const balancesContainer = document.getElementById('top-balances-container');

    // 1. Render Top Balances
    balancesContainer.innerHTML = `
        <div class="col-md-4"><div class="card p-3 shadow-sm"><h5>Start Balance</h5><h3>¥${data.startBalance}</h3></div></div>
        <div class="col-md-4"><div class="card p-3 shadow-sm"><h5>End Balance</h5><h3>¥${data.endBalance}</h3></div></div>
        <div class="col-md-4"><div class="card p-3 shadow-sm"><h5>Saved this Month</h5><h3 class="text-primary">¥${data.saved}</h3></div></div>
    `;

    // 2. Render Expense Rows
    let expenseHTML = '';
    data.expenses.categories.forEach(item => {
        expenseHTML += `
            <tr>
                <td>${item.name}</td>
                <td>¥${item.planned}</td>
                <td>¥${item.actual}</td>
                <td class="${item.diff < 0 ? 'text-danger' : 'text-success'}">¥${item.diff}</td>
            </tr>
        `;
    });
    expensesBody.innerHTML = expenseHTML;
    // 3. Render Income Rows
    let incomeHTML = '';
    data.income.categories.forEach(item => {
        incomeHTML += `
            <tr>
                <td>${item.name}</td>
                <td>¥${item.planned}</td>
                <td>¥${item.actual}</td>
                <td class="${item.diff < 0 ? 'text-danger' : 'text-success'}">¥${item.diff}</td>
            </tr>
        `;
    });
    incomeBody.innerHTML = incomeHTML;
}

// 3. Trigger the network request when the script loads
fetchLiveBudget();