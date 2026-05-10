// script.js

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

// 3. Initialize Chart.js Example
const ctx = document.getElementById('myChart').getContext('2d');
let myChart = new Chart(ctx, {
    type: 'line',
    data: {
        labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
        datasets: [{
            label: 'System Load',
            data: [12, 19, 3, 5, 2, 3],
            borderColor: '#0d6efd',
            backgroundColor: 'rgba(13, 110, 253, 0.2)',
            borderWidth: 2,
            tension: 0.3,
            fill: true
        }]
    },
    options: {
        responsive: true,
        plugins: {
            legend: { labels: { color: document.body.classList.contains('dark-mode') ? '#e0e0e0' : '#212529' } }
        },
        scales: {
            x: { ticks: { color: document.body.classList.contains('dark-mode') ? '#e0e0e0' : '#212529' } },
            y: { ticks: { color: document.body.classList.contains('dark-mode') ? '#e0e0e0' : '#212529' } }
        }
    }
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
const SPREADSHEET_API_URL = "https://script.google.com/macros/s/AKfycby7EMU_5pAyFOjP03KS82diU4ryFwiyk0fkVGRmYIdFpGTz-z9qRwMbuIjEmWiGpbiN/exec";

// 1. Fetch the live data from Google Sheets
async function fetchLiveBudget() {
    const container = document.getElementById('budget-summary-container');
    if (!container) return;

    // Show a loading message while waiting for Google Sheets
    container.innerHTML = '<div class="col-12"><p class="text-muted">Loading live data from Google Sheets...</p></div>';

    try {
        const response = await fetch(SPREADSHEET_API_URL);
        const liveData = await response.json();

        // Pass the live data to our rendering function
        renderOverviewCards(liveData);
    } catch (error) {
        console.error("Error fetching live data:", error);
        container.innerHTML = '<div class="col-12"><p class="text-danger fw-bold">Failed to connect to the spreadsheet API.</p></div>';
    }
}

// 2. Render the visual data flows
function renderOverviewCards(monthlyData) {
    const container = document.getElementById('budget-summary-container');
    let htmlContent = '';

    monthlyData.forEach(data => {
        // Skip empty rows if any exist in the spreadsheet
        if (!data.month) return;

        // To change month into Human readable form
        // normalize month label (handles number, Date, or ISO string)
let monthLabel = data.month;
if (typeof monthLabel === 'number') {
  monthLabel = new Date(monthLabel);
} else if (typeof monthLabel === 'string') {
  const parsed = new Date(monthLabel);
  if (!isNaN(parsed)) monthLabel = parsed;
}

if (monthLabel instanceof Date && !isNaN(monthLabel)) {
  monthLabel = monthLabel.toLocaleString(undefined, { year: 'numeric', month: 'long', timeZone: 'UTC' });
}

        const isPositive = data.saved >= 0;
        const savedColor = isPositive ? 'text-success' : 'text-danger';
        const savedIcon = isPositive ? '▲' : '▼';

        const incomePct = data.income.planned > 0 ? Math.min((data.income.actual / data.income.planned) * 100, 100) : 0;
        const expPct = data.expenses.planned > 0 ? Math.min((data.expenses.actual / data.expenses.planned) * 100, 100) : 0;

        const expColor = data.expenses.actual > data.expenses.planned ? 'bg-danger' : 'bg-warning';

        htmlContent += `
        <div class="col-md-6 mb-4">
            <div class="card shadow-sm h-100">
                <div class="card-body">
                    <h5 class="card-title fw-bold text-secondary">${monthLabel}</h5>
                    <h3 class="${savedColor} mb-4">
                        ${savedIcon} ¥${Math.abs(data.saved).toLocaleString()} 
                        <span class="fs-6 text-muted" style="color: var(--text-color) !important;">Net Savings</span>
                    </h3>
                    
                    <div class="mb-3">
                        <div class="d-flex justify-content-between mb-1" style="font-size: 0.9rem;">
                            <span>Income (Actual vs Planned)</span>
                            <strong>¥${data.income.actual.toLocaleString()} / ¥${data.income.planned.toLocaleString()}</strong>
                        </div>
                        <div class="progress" style="height: 8px;">
                            <div class="progress-bar bg-success" role="progressbar" style="width: ${incomePct}%"></div>
                        </div>
                    </div>

                    <div class="mb-3">
                        <div class="d-flex justify-content-between mb-1" style="font-size: 0.9rem;">
                            <span>Expenses (Actual vs Planned)</span>
                            <strong>¥${data.expenses.actual.toLocaleString()} / ¥${data.expenses.planned.toLocaleString()}</strong>
                        </div>
                        <div class="progress" style="height: 8px;">
                            <div class="progress-bar ${expColor}" role="progressbar" style="width: ${expPct}%"></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        `;
    });

    container.innerHTML = htmlContent;
}

// 3. Trigger the network request when the script loads
fetchLiveBudget();