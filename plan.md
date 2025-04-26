**Software Description for AI-Directed Performance System**

### Overview

The AI-Directed Performance System is an interactive, real-time performance tool that recreates a scene from _Jurassic Park_ using pose tracking, audience-generated sound effects, and an automated camera and editing system. The system consists of a **shot database** containing predefined camera angles and ins-and-outs points for the editor. There is an automated teleprompter system which has a **main screen** and a **character screen** which guides actors through each shot. The character teleprompter plays videos for each individual character which includes their lines and stage directions. After the scene is complete, the software compiles audiovisual assets from a structured directory that mirrors the shot database file into a single video file.

This project should work on both MacOS and Linux.

### **Core Functionalities**

#### **Intake App** (this web app is in a separate repository)

- Upon entering the space, participants scan a **QR code** that takes them to a **web-based Intake App**.
- The app collects basic information: **photo, name, and a short acting exercise** (e.g., "act sad and say this line").
- This data is used by the AI director to identify participants and assist in actor selection.

#### **AI Director System**

The **AI director** orchestrates the performance and ensures that each shot closely matches its reference from the film. It performs the following tasks:

- Originally this was intended to have an AI generated voice, but for the first performance we will have a real human comedian speaking to the participants in real-time. There are some parts in the code which are still using the AI voice. I will leave them in but generally not use them for now.
- Calls actors to the **stage area** by name via the main teleprompter. When initializing a scene, the main teleprompter first displays "Initializing scene...". Then, as actors are called, it displays the actor's name, their assigned character, their **headshot**, and a **QR code** which links directly to that character's specific teleprompter view (e.g., `http://<host>:<port>/teleprompter/<characterName>`).
- Displays dialogue and blocking cues on **mobile character teleprompters** (accessed via the QR code on the main teleprompter or by manually navigating to the URL).
- Directs camera movements to align with the shot.
- Records actor **dialogue** and **audience sound effects** in separate audio files.
- Orchestrates the recording of a **musical soundtrack** by the audience post-performance.

#### **Performance Recording & File Organization**

- Each shot is saved in a **directory structure matching the shot database**.
- **Video files** are recorded concurrently for all cameras specified in a shot using **Node.js Worker Threads**. Each worker handles the full pipeline (capture, frame extraction, pose tracking, overlay encoding) for a single camera, preventing the main thread from blocking.
- The recording process uses either **FFmpeg** or **GStreamer**, initiated by helper services (`ffmpegHelper.js`, `gstreamerHelper.js`).
- Pose tracking is performed on the extracted frames, and the resulting overlay video is stored with metadata (e.g., pose accuracy score, shot number) in a camera-specific subdirectory within the session directory (e.g., `recordings/<session_id>/<camera_name>/`).
- **Skeletor** is a node module I have created which takes a video as input and uses the skeletal data from anyone detected to "cut them out" and place them on a transparent background in a new output video file.
- **Actor dialogue and audience sound effects** are stored separately for post-processing.
- A **final scene compilation** is created based on the best takes.

#### **Audience Sound & Music Participation**

- While actors perform, the **audience creates sound effects**, which are recorded separately.
- After the scene is complete, the AI directs the audience to record a **musical soundtrack**.
- Sound files are stored and synchronized with video for post-production.

---

### **Technical Implementation**

#### **Node.js Application (Primary Coordinator)**

The application is built with **Node.js**, acting as the core event controller:

- **Session Management**: The application uses a session ID (format `YYYYMMDD_HHMMSS`) generated at startup. All recordings and processed files are stored in a subdirectory within `recordings/` named after the current session ID (e.g., `recordings/20231027_103000/`). Camera-specific recordings are stored within named subdirectories (e.g., `recordings/20231027_103000/Camera_1/`). The active session can be changed via the UI.
- **WebSocket-based real-time communication** between AI components and the frontend UI for status updates (including recording progress from workers).
- **Concurrent Recording**: Uses Node.js **Worker Threads** (`workers/recordingWorker.js`) to handle the computationally intensive recording and processing pipeline for each camera simultaneously, ensuring non-blocking operation during shots.
- **Integrates pose tracking models** (e.g., TensorFlow.js, MediaPipe) for movement analysis, executed within the recording worker threads.
- **Manages file storage**, shot metadata, and retrieval within session directories.
- **Plays AI audio voice cues** via text-to-speech APIs (this will not be in use for the first run of the project, which uses a human comedian).
- **Coordinates main and mobile teleprompter displays** through a local web interface and WebSocket communication. The main teleprompter shows initialization status and actor assignments with headshots and QR codes. Character teleprompters show specific lines and cues.

#### **Hardware & Camera Control**

- **PTZ cameras** track and record actor performances.
- **Microphones capture dialogue** and audience sound effects.
- **Mobile teleprompters (phones) display script lines and directions.**

#### **AI & Machine Learning Components**

- **Pose tracking models** analyze actor movement.
- **Text-to-speech AI** for vocalizing the AI director's instructions.

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
│   └── /js             # Client-side JavaScript files (NEW)
│       └── home.js       # Client-side logic for home.ejs (NEW)
├── /recordings         # Stored video and audio files per session
│   └── /<session_id>   # Directory for each session (e.g., 20231027_103000)
│       ├── original.mp4  # Original recording for a scene/shot
│       ├── overlay.mp4   # Processed video with overlay
│       ├── frames_raw/   # Extracted raw frames
│       └── frames_overlay/ # Frames with pose overlay
│       └── *.wav         # Converted audio recordings
├── /routes             # API and web routes definition
│   ├── camera.js         # Camera control routes, uses sessionService
│   ├── main.js           # Main application routes, includes session API endpoints (/api/sessions, /api/select-session)
│   └── teleprompter.js   # Teleprompter related routes
├── /services           # Business logic services
│   ├── aiVoice.js        # Text-to-speech service
│   ├── callsheetService.js # Manages callsheet/actor assignment logic
│   ├── camera.js         # Camera class definition
│   ├── cameraControl.js  # PTZ camera control & device management logic
│   ├── ffmpegHelper.js   # Helper for FFmpeg operations (capture, frames, encode)
│   ├── gstreamerHelper.js # Helper for GStreamer operations (capture)
│   ├── poseTracker.js    # Pose tracking service
│   ├── sceneService.js   # Service for managing scene progression (DEPRECATED? Verify usage)
│   └── sessionService.js # Manages session ID and directories
├── /skeletor           # Cuts participants from video using skeletal data
├── /temp               # Temporary files (e.g., uploaded audio before conversion)
├── /temp_uploads       # Temporary uploads directory (e.g., uploaded actor files)
├── /views              # Server-side templates and view logic
│   ├── homeView.js       # Logic for the main/home view, fetches session data
│   ├── teleprompterView.js # Logic for the teleprompter view
│   ├── /styles         # CSS Stylesheets
│   │   └── home.css      # Styles for home.ejs (NEW)
│   └── /templates      # HTML/EJS templates (home.ejs includes session UI)
├── /websocket          # WebSocket handling logic
│   ├── broadcaster.js    # Handles broadcasting messages to clients
│   └── handler.js        # Handles incoming WebSocket messages
├── /workers            # NEW: Worker thread scripts
│   └── recordingWorker.js # Handles concurrent camera recording & processing pipeline
│
├── /.git               # Git repository data (contents not listed)

```

### **API Endpoints**

(Add a summary of key endpoints if desired, including the new session ones)

- `GET /api/sessions`: Returns a list of existing session IDs (directory names in `recordings/`).
- `POST /api/select-session`: Sets the active session ID for the application. Expects `sessionId` in the body.
