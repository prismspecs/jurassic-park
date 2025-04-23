**Software Description for AI-Directed Performance System**

### Overview

The AI-Directed Performance System is an interactive, real-time performance tool that recreates a scene from _Jurassic Park_ using pose tracking, AI-generated direction, and audience participation. The system consists of a **shot database** containing predefined cinematic elements (camera angles, dialogue, body positions) and dynamically guides actors through each shot. The AI director coordinates stage actions, records performances, and compiles audiovisual assets into a structured directory that mirrors the shot database.

### **Core Functionalities**

#### **1. Intake App** (this is in a separate repository)

- Upon entering the space, participants scan a **QR code** that takes them to a **web-based Intake App**.
- The app collects basic information: **photo, name, and a short acting exercise** (e.g., "act sad and say this line").
- This data is used by the AI director to identify participants and assist in actor selection.

#### **2. AI Director System**

The **AI director** orchestrates the performance and ensures that each shot closely matches its reference from the film. It performs the following tasks:

- Calls actors to the **stage area** by name.
- Displays dialogue and blocking cues on **mobile teleprompters** (on the participants' phones).
- Provides real-time **pose tracking feedback** to ensure accurate body positioning.
- Directs camera movements to align with the shot.
- Records actor **dialogue** and **audience sound effects** in separate audio files.
- Orchestrates the recording of a **musical soundtrack** by the audience post-performance.

The AI director, voiced by a human comedian, delivers all instructions over stage speakers.

#### **3. Pose Tracking & Shot Accuracy System**

- Uses **pose estimation models** to track actors' movements.
- Compares real-time positions against stored **shot reference data**.
- Displays **on-screen corrections** to help actors adjust their blocking.
- Adjusts **camera angles** dynamically based on actor positioning.

#### **4. Performance Recording & File Organization**

- Each shot is saved in a **directory structure matching the shot database**.
- **Video files** are recorded and stored with metadata (e.g., pose accuracy score, shot number).
- **Actor dialogue and audience sound effects** are stored separately for post-processing.
- A **final scene compilation** is created based on the best takes.

#### **5. Audience Sound & Music Participation**

- While actors perform, the **audience creates sound effects**, which are recorded separately.
- After the scene is complete, the AI directs the audience to record a **musical soundtrack**.
- Sound files are stored and synchronized with video for post-production.

---

### **Technical Implementation**

#### **1. Node.js Application (Primary Coordinator)**

The application is built with **Node.js**, acting as the core event controller:

- **WebSocket-based real-time communication** between AI components.
- **Integrates pose tracking models** (e.g., TensorFlow.js, MediaPipe) for movement analysis.
- **Manages file storage**, shot metadata, and retrieval.
- **Plays AI audio voice cues** via text-to-speech APIs (this will not be in use for the first run of the project, which uses a human comedian).
- **Coordinates mobile teleprompter displays** through a local web interface.

#### **2. Hardware & Camera Control**

- **PTZ cameras** track and record actor performances.
- **Microphones capture dialogue** and audience sound effects.
- **Mobile teleprompters display script lines and directions.**

#### **3. AI & Machine Learning Components**

- **Pose tracking models** analyze actor movement.
- **Face recognition (for actor identification)** ensures the correct participant is in the scene.
- **Speech recognition** (optional) for capturing dialogue accuracy.
- **Text-to-speech AI** for vocalizing the AI director’s instructions.

---

### **System Workflow**

1. **Participants access the Intake App** via QR code and submit their **photo, name, and acting exercise**.
2. The **AI calls actors to the stage** using text-to-speech.
3. Actors **receive blocking directions** and **read their lines** from the teleprompter.
4. **Pose tracking ensures accuracy** and provides corrections if needed.
5. The **AI dynamically adjusts lighting and camera angles**.
6. Performance is **recorded and saved** in a structured format.
7. **Audience participates** by making sound effects and later recording a musical soundtrack.
8. The **AI compiles the best takes** into a finalized scene.
9. The completed performance is **played on the Offstage Area screen and streamed online**.

---

### **Code Structure**

#### **1. Project Structure**

```
/ai-director
│── /server              # Node.js backend
│   │── index.js          # Main application entry point
│   │── routes.js         # API routes
│   │── ws-handler.js     # WebSocket event handling
│   │── pose-tracker.js   # Handles pose estimation logic
│   │── file-manager.js   # Saves and organizes recordings
│   │── ai-voice.js       # Text-to-speech module
│── /client              # Frontend (Intake App & Teleprompter UI)
│   │── index.html        # Web interface for actors and audience
│   │── styles.css        # Frontend styling
│   │── script.js         # Client-side logic
│── /models              # AI models for face recognition & pose tracking
│── /data                # Shot database and metadata
│── /recordings          # Video and audio files
│── package.json         # Node.js dependencies
│── README.md            # Project documentation
```

---

### **System Requirements & Deployment**

#### **Hardware Requirements**

- **NVIDIA 3060 12GB GPU** (Recommended: NVIDIA 4070 12GB for better real-time performance)
- **Intel i7 10700F @ 2.9GHz**
- **32GB DDR4 RAM**
- **1TB SSD (Primary)** + **2TB HDD (Storage)**
- **PTZ Cameras, Microphones, Teleprompters, and DMX Controller**

#### **Software Stack**

- **Node.js** (main application)
- **WebSockets & HTTP Server** (for real-time communication)
- **FFmpeg** (for video encoding and processing)
- **TensorFlow.js / MediaPipe** (pose tracking models)
- **AWS S3 / Local Storage** (for storing recorded files)

---

### **Future Development Considerations**

- **Multi-camera synchronization** for seamless shot transitions.
- **Automated editing software** to compile the final scene.
- **Integration with VR** to allow remote participation.
- **Machine learning-driven actor feedback** for refining performances.

This software aims to create an immersive, AI-directed performance experience where actors and audiences collaborate under the guidance of an intelligent system, closely replicating the original cinematic sequence.
