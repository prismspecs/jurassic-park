class State {
    constructor(name) {
        this.name = name;
    }
}

const PreparationState = new State("Preparation");
const PerformanceState = new State("Performance");
const ScoringState = new State("Scoring");

let currentState = PreparationState;

function handleReady() {
    // Setup participants, AI voice, camera position, etc.
    console.log("Setup complete.");
    transitionTo(PerformanceState);
}

function handleFinishedPerformance() {
    // Score the performance and store it in a database.
    console.log("Performance finished.");
    transitionTo(ScoringState);
}

function setupEventListeners() {
    document.addEventListener("ready", handleReady);
    document.addEventListener("performanceFinished",
        handleFinishedPerformance);
}

function transitionTo(newState) {
    currentState = newState;
    console.log(`Transitioned to state: ${currentState.name}`);
}

setupEventListeners();