// gameConfig.js
module.exports = {
    ALL_ROLES: ['Loup-Garou', 'Villageois', 'Sorcière', 'Voyante', 'Chasseur', 'Cupidon', 'Voleur'],
    // Durées normales (en ms)
    DURATIONS: {
        DAY: 45000,
        NIGHT: 30000,
        WITCH: 20000,
        HUNTER: 15000,
        CUPID: 20000,
        SEER: 20000,
        THIEF: 20000,
        CAPTAIN_ELECTION: 20000,
        CAPTAIN_SUCCESSION: 20000
    },
    // Durées rapides pour le mode Dev (en ms)
    DEV_DURATIONS: {
        DAY: 10000,
        NIGHT: 5000,
        WITCH: 15000,
        HUNTER: 15000,
        CUPID: 15000,
        SEER: 10000,
        THIEF: 15000,
        CAPTAIN_ELECTION: 10000,
        CAPTAIN_SUCCESSION: 5000
    }
};
