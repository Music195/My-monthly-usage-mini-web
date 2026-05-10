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