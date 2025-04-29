import { logToConsole } from './logger.js';

/**
 * Initializes the draggable resizer handles for the three-column layout.
 */
export function initializeResizers() {
    const leftSidebar = document.querySelector('.left-sidebar');
    const mainContent = document.querySelector('.main-content');
    const rightSidebar = document.querySelector('.sidebar'); // Use .sidebar class as defined in home.ejs
    const resizerLeftMain = document.getElementById('resizer-left-main');
    const resizerMainRight = document.getElementById('resizer-main-right');

    // Check if all elements exist before proceeding
    if (!leftSidebar || !mainContent || !rightSidebar || !resizerLeftMain || !resizerMainRight) {
        console.error("One or more layout elements or resizers not found. Resizing disabled.");
        logToConsole("Layout resizing setup failed: Elements missing.", "error");
        return; 
    }

    let isResizing = false;
    let startX, initialLeftBasis, initialRightBasis;
    let currentResizer = null;
    let initialMainContentWidth = 0; // Store main content width for right handle

    // Helper to get computed basis or width
    const getBasis = (el) => {
      const basis = getComputedStyle(el).flexBasis;
      if (basis === 'auto' || basis === 'content' || !basis.endsWith('px')) {
        // Fallback to offsetWidth if basis is not a pixel value
        return el.offsetWidth;
      }
      return parseInt(basis, 10);
    };

    const startResize = (e, resizer) => {
      // Prevent text selection during drag
      e.preventDefault(); 
      // console.log('Resizer mousedown detected on:', resizer.id); // Optional debugging
      
      isResizing = true;
      currentResizer = resizer;
      startX = e.clientX;

      // Get initial basis values
      initialLeftBasis = getBasis(leftSidebar);
      initialRightBasis = getBasis(rightSidebar);
      initialMainContentWidth = mainContent.offsetWidth; // Get main content width

      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize'; // Indicate resizing globally

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', stopResize, { once: true }); // Use {once: true} for cleanup
    };

    const handleMouseMove = (e) => {
      if (!isResizing) return;

      // Use requestAnimationFrame for smoother resizing
      window.requestAnimationFrame(() => {
          const currentX = e.clientX;
          const dx = currentX - startX;

          const minLeftWidth = parseInt(getComputedStyle(leftSidebar).minWidth, 10) || 50; // Fallback min width
          const minRightWidth = parseInt(getComputedStyle(rightSidebar).minWidth, 10) || 50;
          const minMainWidth = parseInt(getComputedStyle(mainContent).minWidth, 10) || 100;
          const totalWidth = document.querySelector('.page-layout').offsetWidth; // Use page-layout width
          const resizerWidth = resizerLeftMain.offsetWidth + resizerMainRight.offsetWidth; // Combined width of both handles

          if (currentResizer === resizerLeftMain) {
              let newLeftBasis = initialLeftBasis + dx;
              let newMainWidth = totalWidth - newLeftBasis - initialRightBasis - resizerWidth; // Main adjusts to fill remaining space

              // Clamp left basis
              if (newLeftBasis < minLeftWidth) {
                  newLeftBasis = minLeftWidth;
              }
              // Recalculate main width based on clamped left basis
              newMainWidth = totalWidth - newLeftBasis - initialRightBasis - resizerWidth;

              // Clamp main width (if it became too small due to large left basis)
              if (newMainWidth < minMainWidth) {
                  newMainWidth = minMainWidth;
                  // Recalculate left basis if main width needed clamping
                  newLeftBasis = totalWidth - newMainWidth - initialRightBasis - resizerWidth;
              }
              
              // Apply styles
              leftSidebar.style.flexBasis = `${newLeftBasis}px`;
              mainContent.style.flexBasis = `${newMainWidth}px`;
              mainContent.style.flexGrow = '0'; // Prevent flex grow during drag
              leftSidebar.style.flexGrow = '0';
              rightSidebar.style.flexGrow = '0';


          } else if (currentResizer === resizerMainRight) {
              let newRightBasis = initialRightBasis - dx; // Right basis decreases as mouse moves right
              let newMainWidth = totalWidth - initialLeftBasis - newRightBasis - resizerWidth; // Main adjusts

               // Clamp right basis
              if (newRightBasis < minRightWidth) {
                  newRightBasis = minRightWidth;
              }
               // Recalculate main width based on clamped right basis
              newMainWidth = totalWidth - initialLeftBasis - newRightBasis - resizerWidth;

               // Clamp main width (if it became too small due to large right basis)
              if (newMainWidth < minMainWidth) {
                  newMainWidth = minMainWidth;
                   // Recalculate right basis if main width needed clamping
                  newRightBasis = totalWidth - initialLeftBasis - newMainWidth - resizerWidth;
              }

              // Apply styles
              rightSidebar.style.flexBasis = `${newRightBasis}px`;
              mainContent.style.flexBasis = `${newMainWidth}px`;
              mainContent.style.flexGrow = '0'; // Prevent flex grow during drag
              rightSidebar.style.flexGrow = '0';
              leftSidebar.style.flexGrow = '0';
          }
      });
    };

    const stopResize = () => {
      if (isResizing) {
        isResizing = false;
        
        document.removeEventListener('mousemove', handleMouseMove);
        // 'mouseup' listener removed by {once: true}

        // Restore user interaction styles
        document.body.style.userSelect = '';
        document.body.style.cursor = '';

        // Allow main content to grow again, let others be fixed
        mainContent.style.flexGrow = '1'; 
        leftSidebar.style.flexGrow = '0';
        rightSidebar.style.flexGrow = '0';
        
        currentResizer = null; // Clear the current resizer
      }
    };

    resizerLeftMain.addEventListener('mousedown', (e) => startResize(e, resizerLeftMain));
    resizerMainRight.addEventListener('mousedown', (e) => startResize(e, resizerMainRight));

    logToConsole("Layout resizers initialized.", "info");
} 