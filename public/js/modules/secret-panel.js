/**
 * Initializes the secret control panel functionality.
 */
export function initializeSecretPanel() {
    const toggleButton = document.getElementById('toggle-secret-panel-btn');
    const secretPanel = document.getElementById('secret-panel');

    if (!toggleButton || !secretPanel) {
        console.warn('Secret panel elements not found.');
        return;
    }

    // Toggle panel visibility on button click
    toggleButton.addEventListener('click', () => {
        const isHidden = secretPanel.style.display === 'none';
        secretPanel.style.display = isHidden ? 'block' : 'none';
        console.log(`Secret panel ${isHidden ? 'shown' : 'hidden'}.`);
    });

    // Add keypress listeners for style toggles
    document.addEventListener('keydown', (event) => {
        // Ignore keypresses if modifier keys are held (unless intended)
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
            // Allow Shift+H if needed in the future, but for now, require just 'h'
            // if (!(event.shiftKey && event.key.toUpperCase() === 'H')) {
            //     return;
            // }
            return;
        }

        switch (event.key.toUpperCase()) {
            case 'H':
                console.log('Toggling headers (H key pressed)');
                document.body.classList.toggle('hide-headers');
                // Optionally, update status within the panel if needed
                break;
            // Add more cases for other keys here
            // case 'C':
            //     console.log('Toggling some other style (C key pressed)');
            //     document.body.classList.toggle('some-other-style');
            //     break;
            default:
                // Do nothing for other keys
                break;
        }
    });

    console.log('Secret panel initialized.');
}
