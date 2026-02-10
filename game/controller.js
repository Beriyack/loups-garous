const { generateRoomId } = require('./utils');
const phases = require('./phases');
const bots = require('./bots');
const actions = require('./actions');
const core = require('./core');

// Initialisation des phases avec les callbacks nécessaires
phases.init({
    botAction: bots.botAction,
    handleThiefAction: actions.handleThiefAction
});

// Initialisation des bots avec les callbacks nécessaires
bots.init({
    handleVote: actions.handleVote,
    handleWitchAction: actions.handleWitchAction
});

// Initialisation des actions avec les modules nécessaires
actions.init({
    bots,
    phases
});

// Initialisation du core avec les modules nécessaires
core.init(phases);

module.exports = {
    generateRoomId,
    ...core,
    ...actions
};