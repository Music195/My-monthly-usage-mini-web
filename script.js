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

// This represents the data pulled from your Google Sheets
const monthlyData = [
    {
        month: "April 2026",
        income: { planned: 220000, actual: 275296 },
        expenses: { planned: 130000, actual: 237292 },
        saved: 38004
    },
    {
        month: "May 2026",
        income: { planned: 200000, actual: 0 },
        expenses: { planned: 95000, actual: 77549 },
        saved: -77549 
    }
];

// Function to generate the budget cards visually
function renderOverviewCards() {
    const container = document.getElementById('budget-summary-container');
    // If the container isn't loaded on the page, don't try to run the code
    if (!container) return; 
    
    let htmlContent = '';

    monthlyData.forEach(data => {
        // Determine colors based on positive/negative savings
        const isPositive = data.saved >= 0;
        const savedColor = isPositive ? 'text-success' : 'text-danger';
        const savedIcon = isPositive ? '▲' : '▼';

        // Calculate visual progress bar widths (capped at 100%)
        const incomePct = data.income.planned > 0 ? Math.min((data.income.actual / data.income.planned) * 100, 100) : 0;
        const expPct = data.expenses.planned > 0 ? Math.min((data.expenses.actual / data.expenses.planned) * 100, 100) : 0;
        
        // Turn expense bar red if you went over budget
        const expColor = data.expenses.actual > data.expenses.planned ? 'bg-danger' : 'bg-warning';

        htmlContent += `
        <div class="col-md-6 mb-4">
            <div class="card shadow-sm h-100">
                <div class="card-body">
                    <h5 class="card-title fw-bold text-secondary">${data.month}</h5>
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

// Call the function to render the cards when the script loads
renderOverviewCards();