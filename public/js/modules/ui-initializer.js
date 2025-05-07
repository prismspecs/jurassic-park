import { logToConsole } from './logger.js'; // Assuming logger is in the same directory or adjust path

// --- Initialize Collapsible Sections ---
export function initializeCollapsibleSections() {
    document.querySelectorAll('.collapsible-header').forEach(header => {
        const section = header.closest('.collapsible-section');
        const content = section.querySelector('.collapsible-content');

        // Respect start-collapsed class if present
        const startCollapsed = section.classList.contains('start-collapsed');
        if (!startCollapsed) {
            header.classList.add('expanded');
            if (content) content.style.display = ''; // Or block, depending on original CSS
        } else {
            // Already collapsed by default or CSS, ensure content is hidden if JS is manipulating it
            if (content) content.style.display = 'none';
        }

        header.addEventListener('click', () => {
            const isExpanding = !header.classList.contains('expanded');
            header.classList.toggle('expanded', isExpanding);

            if (content) {
                // Simple display toggle; for animations, use classes and CSS transitions
                content.style.display = isExpanding ? '' : 'none'; // Or block
            }
        });
    });
}

// --- Initialize Fullscreen Toggles ---
export function initializeFullscreenToggles() {
    document.querySelectorAll('.fullscreen-toggle-btn').forEach(button => {
        button.addEventListener('click', () => {
            const targetId = button.dataset.target;
            const targetPanel = document.getElementById(targetId);
            const pageLayout = targetPanel.closest('.page-layout'); // Assuming this structure exists

            if (!targetPanel || !pageLayout) {
                logToConsole(`Fullscreen toggle target or page-layout not found for ${targetId}`, 'warn');
                return;
            }

            const isCurrentlyFullscreen = targetPanel.classList.contains('fullscreen');
            const children = Array.from(pageLayout.children);

            if (isCurrentlyFullscreen) {
                targetPanel.classList.remove('fullscreen');
                children.forEach(child => {
                    if (child !== targetPanel) {
                        child.classList.remove('panel-hidden');
                    }
                });
                // Update button text/icon if needed
                // button.textContent = 'Go Fullscreen';
            } else {
                targetPanel.classList.add('fullscreen');
                children.forEach(child => {
                    if (child !== targetPanel) {
                        child.classList.add('panel-hidden');
                    }
                });
                // Update button text/icon if needed
                // button.textContent = 'Exit Fullscreen';
            }
        });
    });
}

// --- Initialize Secret Panel ---
export function initializeSecretPanel() {
    const toggleBtn = document.getElementById('secret-panel-toggle-btn');
    const secretPanel = document.getElementById('secret-panel');
    const toggleHeadersCheckbox = document.getElementById('hideHeadersToggle');
    const body = document.body;
    const invertColorsBtn = document.getElementById('invertColorsBtn');

    if (!toggleBtn || !secretPanel || !toggleHeadersCheckbox) {
        logToConsole('Secret panel core elements not found. Cannot initialize fully.', 'warn');
        // return; // Decide if partial initialization is okay or if it should halt
    }

    function toggleHeadersVisibility() {
        const headersHidden = body.classList.toggle('hide-headers');
        if (toggleHeadersCheckbox) toggleHeadersCheckbox.checked = headersHidden;
        logToConsole(`Headers ${headersHidden ? 'hidden' : 'visible'}`, 'info');
    }

    if (toggleBtn && secretPanel) {
        toggleBtn.addEventListener('click', () => {
            secretPanel.classList.toggle('secret-panel-visible');
            logToConsole(`Secret panel ${secretPanel.classList.contains('secret-panel-visible') ? 'shown' : 'hidden'}`, 'info');
        });
    }

    if (toggleHeadersCheckbox) {
        toggleHeadersCheckbox.addEventListener('change', toggleHeadersVisibility);
    }

    document.addEventListener('keydown', (event) => {
        // Ignore if typing in an input field
        if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA' || event.target.tagName === 'SELECT') {
            return;
        }
        if (event.key === 'h' || event.key === 'H') {
            toggleHeadersVisibility();
        }
    });

    if (invertColorsBtn) {
        invertColorsBtn.addEventListener('click', () => {
            document.body.classList.toggle('color-scheme-inverted');
            logToConsole('Toggled inverted color scheme.', 'info'); // Changed from console.log to logToConsole
            if (document.body.classList.contains('color-scheme-inverted')) {
                localStorage.setItem('colorScheme', 'inverted');
            } else {
                localStorage.removeItem('colorScheme');
            }
        });
    }

    // Apply persisted color scheme on load
    if (localStorage.getItem('colorScheme') === 'inverted') {
        document.body.classList.add('color-scheme-inverted');
    }

    logToConsole('Secret panel initialized.', 'info');
} 