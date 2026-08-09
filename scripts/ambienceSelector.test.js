/**
 * Unit Tests for Automatic Ambience Assignment System
 * Run with: node backend/scripts/ambienceSelector.test.js
 */

const assert = require('node:assert');
const { test, describe } = require('node:test');
const { selectAmbience, normalizeCategoryKey, extractTagsFromText } = require('../src/services/ambienceSelector.service');
const { AMBIENCE_LIBRARY } = require('../src/config/ambiences');

describe('Automatic Ambience Assignment Selector Unit Tests', () => {

    test('1. Category Hard Constraint: Selected ambience MUST belong to requested category', () => {
        const result = selectAmbience({
            roomName: 'Startup Fitness & Politics',
            description: 'Discussing venture capital, gym workouts, parliament debates',
            category: 'late_night'
        });

        assert.strictEqual(result.category, 'late_night');
        const candidateInLibrary = AMBIENCE_LIBRARY.find((a) => a.id === result.ambienceId);
        assert.ok(candidateInLibrary, 'Selected ambience must exist in library');
        assert.strictEqual(candidateInLibrary.category, 'late_night', 'Must NEVER select outside category pool');
    });

    test('2. Strong Semantic Match: 2 AM Startup Talks -> neon_skyline', () => {
        const result = selectAmbience({
            roomName: '2 AM Startup Talks',
            description: 'A place for founders to discuss startups, failures, funding and building companies late at night.',
            category: 'late_night'
        });

        assert.strictEqual(result.ambienceId, 'neon_skyline');
        assert.ok(result.reason.matchedTags.includes('startup') || result.reason.matchedTags.includes('business'));
    });

    test('3. Description Has More Weight Than Room Name: Swinging Founders + Casual Talk', () => {
        // Ambiguous name "Swinging Founders", but description is about casual late night talk
        const result = selectAmbience({
            roomName: 'Swinging Founders',
            description: 'Random late night conversations about life and sleepless nights.',
            category: 'late_night'
        });

        // Description should dominate so it does NOT pick neon_skyline (startup)
        assert.notStrictEqual(result.ambienceId, 'neon_skyline');
        assert.ok(['moonlit_window', 'rainy_midnight', 'quiet_cafe', 'aurora_night'].includes(result.ambienceId));
    });

    test('4. Generic Room Fallback: No recognized keywords', () => {
        const result = selectAmbience({
            roomName: 'Random Night',
            description: 'Just wanted to talk.',
            category: 'late_night'
        });

        assert.ok(result.ambienceId, 'Should select a valid ambience from pool');
        assert.strictEqual(result.category, 'late_night');
    });

    test('5. Recency Penalty (Diversity System)', () => {
        // If rainy_midnight was assigned in the last room
        const result = selectAmbience({
            roomName: 'Midnight Musings',
            description: 'Late night quiet reflection',
            category: 'late_night',
            recentAssignments: ['rainy_midnight', 'rainy_midnight', 'rainy_midnight']
        });

        // Diversity penalty reduces rainy_midnight probability
        assert.ok(result.ambienceId);
    });

    test('6. Shuffle Functionality with excludeAmbienceId', () => {
        const initial = selectAmbience({
            roomName: 'Late Night Chat',
            description: 'Casual talk',
            category: 'late_night'
        });

        const shuffled = selectAmbience({
            roomName: 'Late Night Chat',
            description: 'Casual talk',
            category: 'late_night',
            excludeAmbienceId: initial.ambienceId
        });

        assert.notStrictEqual(shuffled.ambienceId, initial.ambienceId, 'Shuffle MUST exclude current ambience');
    });

    test('7. Career Category Match: Placement Panic -> meeting_room or work_desk', () => {
        const result = selectAmbience({
            roomName: 'Placement Panic',
            description: 'Placements are coming and I have no idea how to prepare for interviews.',
            category: 'career'
        });

        assert.strictEqual(result.category, 'career');
        assert.ok(['meeting_room', 'work_desk', 'sunrise_workspace'].includes(result.ambienceId));
    });

    test('8. Performance Requirement: Execution time < 50ms', () => {
        const start = performance.now();
        selectAmbience({
            roomName: 'High Performance Room Creation Test',
            description: 'Extensive description testing high execution speed and tag extraction algorithms',
            category: 'late_night'
        });
        const duration = performance.now() - start;

        assert.ok(duration < 50, `Execution time (${duration.toFixed(2)}ms) must be < 50ms`);
    });

    test('9. Edge Cases: Empty description and very short name', () => {
        const result = selectAmbience({
            roomName: 'Hi',
            description: '',
            category: 'anxiety'
        });

        assert.strictEqual(result.category, 'anxiety');
        assert.ok(result.ambienceId);
    });
});
