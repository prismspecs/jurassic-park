**Software Description for AI-Directed Performance System**

### Overview

The AI-Directed Performance System is an interactive, real-time performance tool that recreates a scene from _Jurassic Park_ using pose tracking, audience-generated sound effects, and an automated camera and editing system. The system consists of a **shot database** containing predefined camera angles and ins-and-outs points for the editor. There is an automated teleprompter system which has a **main screen** and a **character screen** which guides actors through each shot. The character teleprompter plays videos for each individual character which includes their lines and stage directions. After the scene is complete, the software compiles audiovisual assets from a structured directory that mirrors the shot database file into a single video file.

This project should work on both MacOS and Linux. This version of Node does not support ?. syntax. When you start using import statements in your client-side JavaScript, you need to tell the browser that the script file is an ES module.

### **Core Functionalities**

#### **Intake App** (this web app is in a separate repository)

- Upon entering the space, participants scan a **QR code** that takes them to a **web-based Intake App**.
- The app collects basic information: **photo, name, and a short acting exercise** (e.g., "act sad and say this line").
- This data is used by the AI director to identify participants and assist in actor selection.

#### **AI Director System**

The **AI director** orchestrates the performance and ensures that each shot closely matches its reference from the film. It performs the following tasks:

- Originally this was intended to have an AI generated voice, but for the first performance we will have a real human comedian speaking to the participants in real-time. There are some parts in the code which are still using the AI voice. I will leave them in but generally not use them for now.
- Calls actors to the **stage area** by name via the main teleprompter. When initializing a scene, the main teleprompter first displays "Initializing scene...". Then, as actors are called, it displays the actor's name, their assigned character, their **headshot**, the **prop(s)** associated with the character (reading from the `props` key in `scenes.json`, which can be a string or an array, and displaying corresponding images from `/database/props/`), and a **QR code** which links directly to that character's specific teleprompter view (e.g., `http://<host>:<port>/teleprompter/<characterName>`).
- Displays dialogue and blocking cues on **mobile character teleprompters** (accessed via the QR code on the main teleprompter or by manually navigating to the URL).
- **[COMPLETED] Live Video on Teleprompter**: The main recorder canvas (including live video with optional pose effects) can be streamed to the main teleprompter page. This is initiated from the home page and includes controls to show/hide the live feed on the teleprompter.
- Directs camera movements to align with the shot.
- Records actor **dialogue** and **audience sound effects** in separate audio files.
- Orchestrates the recording of a **musical soundtrack** by the audience post-performance.

#### **Performance Recording & File Organization**

- Each shot is saved in a **directory structure matching the shot database**.
- **Video files** are recorded concurrently for all cameras specified in a shot using **Node.js Worker Threads** (`workers/recordingWorker.js`). Each worker handles video capture using **FFmpeg** or **GStreamer**, initiated by helper services (`ffmpegHelper.js`, `gstreamerHelper.js`), saving the raw video to a camera-specific subdirectory within the session directory (e.g., `recordings/<session_id>/<camera_name>/original.mp4`).
- **Live Pose Tracking & Overlay**: Pose tracking is performed _client-side_ in the browser directly on the live camera preview streams using **TensorFlow.js (MoveNet)**. The skeleton is drawn onto an overlay canvas in the UI (`public/js/modules/camera-manager.js`). This provides immediate visual feedback but is _not_ part of the recorded video file.
- **Skeletor** is a separate Node.js module designed to take a _recorded_ video file as input and use skeletal data (potentially generated offline or via a different process) to create a new video with the subject isolated on a transparent background. Its integration with the live recording process needs clarification.
- **Actor dialogue and audience sound effects** are stored separately for post-processing.

#### **Audio Recording Enhancements**
*   **Device Control**: The UI now allows selecting specific audio input devices for recording.
*   **Gain Control**: Each selected audio device card includes a slider (-24dB to +12dB) to adjust the input gain using the `sox` command's `vol` effect.
*   **Channel Selection**: Each selected audio device card provides options (Mono Ch1, Mono Ch2, Stereo Ch1+2) to select input channels using the `sox` command's `remix` effect. (Future enhancement: Dynamically populate channel options based on detected device capabilities).
*   **Backend**: The `AudioRecorder` service (`services/audioRecorder.js`) uses `sox` for recording and applies gain/channel settings via command-line arguments. API endpoints (`/api/audio/*`) manage device selection and configuration.

#### **Final Scene Compilation**
*   A final scene compilation is created based on the best takes.

#### **Audience Sound & Music Participation**

- While actors perform, the **audience creates sound effects**, which are recorded separately.
- After the scene is complete, the AI directs the audience to record a **musical soundtrack**.
- Sound files are stored and synchronized with video for post-production.

---

### **Technical Implementation**

#### **Node.js Application (Primary Coordinator)**

The application is built with **Node.js**, acting as the core event controller:

- **Session Management**: Users manually create named sessions via the UI. The system generates a session ID using the format `YYYY-MM-DD_HH-MM_<sanitized_user_name>` and immediately creates the corresponding _base session directory_ (e.g., `recordings/YYYY-MM-DD_HH-MM_MySession/`) within `recordings/`. The application automatically selects the most chronologically recent session on startup. Users can switch between existing sessions using the UI. The _camera-specific subdirectories_ (e.g., `recordings/<session_id>/<camera_name>/`) are created on-demand by the recording worker just before it needs to write files into them. Session state (current session ID, list of sessions) is managed by `sessionService.js` and exposed via API endpoints in `routes/main.js`. The frontend UI in `home.ejs` and `public/js/home.js` handles displaying the current session, listing available sessions, and provides controls for creating new sessions and selecting existing ones.
- **WebSocket-based real-time communication** between AI components and the frontend UI for status updates, including session changes (`SESSION_UPDATE`, `SESSION_LIST_UPDATE`).
- **Concurrent Recording**: Uses Node.js **Worker Threads** (`workers/recordingWorker.js`) to handle video capture for each camera simultaneously, ensuring non-blocking operation during shots.
- **Client-Side Pose Tracking**: The frontend JavaScript (`public/js/modules/video-compositor.js`) uses **TensorFlow.js** loaded via CDN to perform real-time pose detection (MoveNet) on the camera preview streams displayed in the browser and draws skeleton overlays. It is configured to use the **WebGPU** backend for potentially improved performance, particularly on macOS via Metal.
- **Robust Client-Side Media Element Management**: For dynamic video elements (e.g., the dinosaur video mask), the system implements robust lifecycle management. This includes integration with the Page Visibility API to gracefully handle playback interruptions when the browser tab is backgrounded/foregrounded. Furthermore, a thorough cleanup process (pausing video, clearing src, detaching event listeners, removing from DOM) is enforced when elements are no longer needed, preventing resource leaks and performance degradation. This is coordinated between `home.js`, `video-compositor.js`, and `source-selector.js` using direct calls and custom events.
- **Manages file storage**, shot metadata, and retrieval within session directories.
- **Plays AI audio voice cues** via text-to-speech APIs (this will not be in use for the first run of the project, which uses a human comedian).
- **Coordinates main and mobile teleprompter displays** through a local web interface and WebSocket communication. The main teleprompter shows initialization status and actor assignments with headshots and QR codes. Character teleprompters show specific lines and cues.
- **Timed PTZ Control**: During scene recording ("Action!"), reads camera movement sequences (pan, tilt, zoom timings in degrees/percent) from `database/scenes.json`. Maps degrees to camera-specific software values and schedules `setPTZ` commands via `setTimeout` to execute movements at designated times within the shot.

#### **Hardware & Camera Control**

- **PTZ cameras** track and record actor performances.
- **Microphones capture dialogue** and audience sound effects.
- **Mobile teleprompters (phones) display script lines and directions.**

#### **AI & Machine Learning Components**

- **Pose tracking models** analyze actor movement.
- **Text-to-speech AI** for vocalizing the AI director's instructions.

#### **Secret Control Panel**

- A hidden control panel, accessible via a "S3CR37 P4N31" button in the left sidebar, provides access to additional styling and debugging options.
- Initially, it contains a toggle to hide/show all header elements (`h1` to `h6`) across the page.
- This toggle can also be activated by pressing the "H" key (case-insensitive) when not focused on an input field.
- The panel is styled with a cryptic, low-light theme.

### **Code Structure**

#### **Project Structure**

```
/
│── app.js              # Main application entry point, initializes session
│── config.json         # Configuration settings
│── package.json        # Node.js dependencies
│── package-lock.json   # Locked dependencies
│── plan.md             # This document
│── todo.md             # Todo list
│── readme.md           # Project documentation
│── auth.json           # Authentication credentials
│── .gitignore          # Git ignore rules
│── .DS_Store           # macOS specific file
│
├── /controllers        # Request handlers / business logic
│   └── sceneController.js # Uses sessionService for path construction
│   └── videoController.js # Uses sessionService for path construction
├── /database           # Database related files (JSON files act as DB)
│   ├── scenes.json       # Scene definitions and shot list
│   ├── /actors         # Actor data (likely JSON files)
│   ├── /scenes         # Scene-specific data (potentially related to recordings)
│   └── /test_content   # Test data for database
├── /external_tools     # Scripts or integrations with external tools (contents not listed)
├── /middleware         # Express middleware functions
│   └── auth.js           # Authentication middleware
├── /node_modules       # Project dependencies (managed by npm/yarn)
├── /old                # Older or deprecated code (contents not listed)
├── /public             # Static assets served by Express
│   └── favicon.ico     # Favicon for web interfaces
│   └── /js             # Client-side JavaScript files
│       └── home.js       # Main client-side logic for home.ejs (now primarily an initializer)
│       └── /modules    # Reusable JS modules
│           └── logger.js
│           └── layout-resizer.js
│           └── camera-manager.js # Handles camera previews, controls, CLIENT-SIDE POSE DETECTION, and unified device selection for preview/record/PTZ.
│           └── session-manager.js
│           └── websocket-handler.js
│           └── control-actions.js
│           └── audio-manager.js
│           └── video-compositor.js
│           └── teleprompter-handler.js # Handles teleprompter streaming logic
│           └── actor-loader.js         # Handles actor loading UI and logic
│           └── source-selector.js      # Handles recording source selection UI and logic
│           └── canvas-recorder.js      # Handles main canvas recording logic (configurable format: mp4/webm, and background color via config.json)
│           └── audio-manager.js        # Handles audio device selection, gain, and channel UI controls
│           └── ui-initializer.js       # Initializes UI components (collapsibles, fullscreen, secret panel)
│           └── scene-assembly.js       # Handles scene assembly UI and logic
│   └── /css            # CSS Stylesheets for public assets
│       └── character-teleprompter.css # Styles for the character teleprompter page
├── /recordings         # Stored video and audio files per session
│   └── /<session_id>   # Directory for each session (e.g., 20231027_103000)
│       └── /<camera_name> # Directory for each camera's recordings
│           └── original.mp4 # Raw video captured by the worker
│       └── *.wav         # Converted audio recordings (dialogue, sfx)
├── /routes             # API and web routes definition
│   ├── camera.js         # Camera control routes, uses sessionService
│   ├── main.js           # Main application routes, includes session API endpoints (/api/sessions, /api/select-session)
│   └── teleprompter.js   # Teleprompter related routes
│   └── main.js           # Also includes audio API endpoints (/api/audio/*)
├── /services           # Business logic services
│   ├── aiVoice.js        # Text-to-speech service
│   ├── callsheetService.js # Manages callsheet/actor assignment logic
│   ├── camera.js         # Camera class definition
│   ├── cameraControl.js  # PTZ camera control & device management logic
│   ├── ffmpegHelper.js   # Helper for FFmpeg operations (capture, encode)
│   ├── gstreamerHelper.js # Helper for GStreamer operations (capture)
│   ├── poseTracker.js    # Pose tracking service (DEPRECATED/REPURPOSED? Verify usage - pose tracking now client-side)
│   ├── sceneService.js   # Service for managing scene progression (DEPRECATED? Verify usage)
│   └── sessionService.js # Manages session ID and directories
│   └── audioRecorder.js  # Manages audio device detection and recording via SoX, including gain/channel control
├── /skeletor           # Cuts participants from video using skeletal data
├── /temp               # Temporary files (e.g., uploaded audio, actor files)
├── /views              # Server-side templates and view logic
│   ├── homeView.js       # Logic for the main/home view, fetches session data
│   ├── teleprompterView.js # Logic for the teleprompter view
│   ├── /styles         # CSS Stylesheets (Note: character-teleprompter.css is in /public/css)
│   │   └── home.css      # Styles for home.ejs
│   └── /templates      # HTML/EJS templates
│       └── home.ejs      # Main control panel UI (includes TFJS CDN scripts, session UI)
├── /websocket          # WebSocket handling logic
│   ├── broadcaster.js    # Handles broadcasting messages to clients
│   └── handler.js        # Handles incoming WebSocket messages
├── /workers            # Worker thread scripts
│   └── recordingWorker.js # Handles concurrent camera video CAPTURE (pose tracking removed)
│
├── /.git               # Git repository data (contents not listed)

```

### **API Endpoints**

(Add a summary of key endpoints if desired, including the new session ones)

- `GET /api/sessions`: Returns a list of existing session IDs (directory names in `recordings/`).
- `POST /api/select-session`: Sets the active session ID.
- `POST /loadActors`: Handles uploading actor files.

### Audio API Endpoints (subset)
- `GET /api/audio/devices`: Lists available input devices.
- `POST /api/audio/active-devices`: Activates a device for recording.
- `DELETE /api/audio/active-devices/:deviceId`: Deactivates a device.
- `POST /api/audio/config/:deviceId`: Sets gain (dB) and channel selection (array) for an active device.
