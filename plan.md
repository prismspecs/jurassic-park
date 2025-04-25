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
- **Video files** are recorded, processed for pose tracking, and the resulting overlay video is stored with metadata (e.g., pose accuracy score, shot number). The initial raw recording is kept temporarily during processing.
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

- **WebSocket-based real-time communication** between AI components.
- **Integrates pose tracking models** (e.g., TensorFlow.js, MediaPipe) for movement analysis.
- **Manages file storage**, shot metadata, and retrieval.
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
│── app.js              # Main application entry point
│── config.json         # Configuration settings
│── package.json        # Node.js dependencies
│── package-lock.json   # Locked dependencies
│── plan.md             # This document
│── todo.md             # Todo list
│── readme.md           # Project documentation
│── auth.json           # Authentication credentials
│── favicon.ico         # Favicon for web interfaces
│── .gitignore          # Git ignore rules
│── .DS_Store           # macOS specific file
│
├── /controllers        # Request handlers / business logic
│   └── sceneController.js
│   └── videoController.js
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
├── /recordings         # Stored video and audio files (contents not listed)
├── /routes             # API and web routes definition
│   ├── camera.js         # Camera control routes
│   ├── main.js           # Main application routes
│   └── teleprompter.js   # Teleprompter related routes (main display and character-specific via /:character)
├── /services           # Business logic services
│   ├── aiVoice.js        # Text-to-speech service
│   ├── callsheetService.js # Manages callsheet/actor assignment logic
│   ├── camera.js         # Camera interaction service (distinct from routes/control)
│   ├── cameraControl.js  # PTZ camera control logic
│   ├── ffmpegHelper.js   # Helper for FFmpeg operations (frame extraction, video encoding with overlay)
│   ├── gstreamerHelper.js # Helper for GStreamer operations (video capture)
│   ├── poseTracker.js    # Pose tracking service
│   └── sceneService.js   # Service for managing scene progression
├── /skeletor           # Purpose unclear from name (contents not listed)
├── /temp               # Temporary files (contents not listed)
├── /temp_uploads       # Temporary uploads directory (contents not listed)
├── /views              # Server-side templates and view logic
│   ├── homeView.js       # Logic for the main/home view
│   ├── teleprompterView.js # Logic for the teleprompter view
│   ├── /styles         # CSS Stylesheets
│   └── /templates      # HTML/EJS templates (e.g., teleprompter.ejs, characterTeleprompter.ejs)
├── /websocket          # WebSocket handling logic
│   ├── broadcaster.js    # Handles broadcasting messages to clients
│   └── handler.js        # Handles incoming WebSocket messages
│
├── /.git               # Git repository data (contents not listed)

```
