/**
 * Tests for external element movement (SortableJS integration)
 * Verifies that list items moved by external libraries are properly rebound
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { loadFramework, resetFramework, getListItems } from './helpers/load-framework.js';

// Helper to wait for framework processing
async function waitForUpdate(ms = 50) {
    await new Promise(resolve => setTimeout(resolve, ms));
}

// Helper to wait for complete render cycle
async function waitForCompleteRender() {
    if (window.wildflower?._forceCompleteRender) {
        await window.wildflower._forceCompleteRender();
    }
    await new Promise(resolve => setTimeout(resolve, 50));
}

describe('External Element Movement', () => {
    let testContainer;
    let wildflower;

    beforeAll(async () => {
        await loadFramework();
    });

    beforeEach(() => {
        wildflower = window.wildflower;
        resetFramework();

        // Clear context registry
        if (wildflower._contextRegistry) {
            wildflower._contextRegistry.contexts?.clear();
            wildflower._contextRegistry.contextsByType?.clear();
            wildflower._contextRegistry.contextsByComponent?.clear();
            wildflower._contextRegistry.dependencies?.clear();
        }

        // Clear list relationships
        if (wildflower._listRelationships) {
            wildflower._listRelationships.clear();
        }

        // Create test container
        testContainer = document.createElement('div');
        testContainer.id = 'test-container';
        testContainer.style.position = 'absolute';
        testContainer.style.left = '-9999px';
        testContainer.style.opacity = '0';
        document.body.appendChild(testContainer);
    });

    afterEach(() => {
        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer);
        }
    });

    describe('Foreign Element Adoption', () => {
        it('should rebind data-show when element is moved between lists', async () => {
            // Setup: Two columns with cards, where canMoveLeft differs by column
            testContainer.innerHTML = `
                <div data-component="column-a">
                    <div class="list-a" data-list="computed:cards" data-key="id">
                        <template>
                            <div class="card" data-bind-attr="({ 'data-card-id': id })">
                                <span data-bind="title"></span>
                                <button class="move-left" data-show="canMoveLeft">Left</button>
                                <button class="move-right" data-show="canMoveRight">Right</button>
                            </div>
                        </template>
                    </div>
                </div>
                <div data-component="column-b">
                    <div class="list-b" data-list="computed:cards" data-key="id">
                        <template>
                            <div class="card" data-bind-attr="({ 'data-card-id': id })">
                                <span data-bind="title"></span>
                                <button class="move-left" data-show="canMoveLeft">Left</button>
                                <button class="move-right" data-show="canMoveRight">Right</button>
                            </div>
                        </template>
                    </div>
                </div>
            `;

            // Column A - cards can move right but not left (first column)
            wildflower.component('column-a', {
                state: {},
                computed: {
                    cards() {
                        return [
                            { id: 1, title: 'Card 1', canMoveLeft: false, canMoveRight: true },
                            { id: 2, title: 'Card 2', canMoveLeft: false, canMoveRight: true }
                        ];
                    }
                }
            });

            // Column B - cards can move left but not right (last column)
            wildflower.component('column-b', {
                state: {},
                computed: {
                    cards() {
                        return [
                            { id: 3, title: 'Card 3', canMoveLeft: true, canMoveRight: false }
                        ];
                    }
                }
            });

            await waitForCompleteRender();

            // Verify initial state
            const listA = testContainer.querySelector('.list-a');
            const listB = testContainer.querySelector('.list-b');

            // Column A has 2 cards, Column B has 1 card
            expect(getListItems(listA).length).toBe(2);
            expect(getListItems(listB).length).toBe(1);

            // In Column A: cards can move right but not left
            const cardA1 = listA.querySelector('.card[data-card-id="1"]');
            // data-show uses inline style.display for visibility
            expect(cardA1.querySelector('.move-left').style.display).toBe('none');
            expect(cardA1.querySelector('.move-right').style.display).toBe('');

            // In Column B: cards can move left but not right
            const cardB3 = listB.querySelector('.card[data-card-id="3"]');
            expect(cardB3.querySelector('.move-left').style.display).toBe('');
            expect(cardB3.querySelector('.move-right').style.display).toBe('none');
        });

        it('should properly adopt foreign element with new data-show values', async () => {
            // This test simulates what happens when SortableJS moves an element
            // from one list to another and the framework needs to rebind it

            // Create store for state management
            wildflower.store('kanban', {
                state: {
                    columnA: [
                        { id: 1, title: 'Card 1' },
                        { id: 2, title: 'Card 2' }
                    ],
                    columnB: [
                        { id: 3, title: 'Card 3' }
                    ]
                },
                moveCard(cardId, fromList, toList) {
                    const fromArr = this.state[fromList];
                    const toArr = this.state[toList];
                    const cardIndex = fromArr.findIndex(c => c.id === cardId);
                    if (cardIndex >= 0) {
                        const [card] = fromArr.splice(cardIndex, 1);
                        toArr.push(card);
                        // Trigger immutable update
                        this.state[fromList] = [...fromArr];
                        this.state[toList] = [...toArr];
                    }
                }
            });

            testContainer.innerHTML = `
                <div data-component="kanban-col-a" class="col-a">
                    <div class="card-list" data-list="computed:cards" data-key="id">
                        <template>
                            <div class="card" data-bind-attr="({ 'data-card-id': id })">
                                <span data-bind="title"></span>
                                <button class="move-left" data-show="canMoveLeft">\u2190</button>
                            </div>
                        </template>
                    </div>
                </div>
                <div data-component="kanban-col-b" class="col-b">
                    <div class="card-list" data-list="computed:cards" data-key="id">
                        <template>
                            <div class="card" data-bind-attr="({ 'data-card-id': id })">
                                <span data-bind="title"></span>
                                <button class="move-left" data-show="canMoveLeft">\u2190</button>
                            </div>
                        </template>
                    </div>
                </div>
            `;

            // Column A - cards cannot move left (first column)
            wildflower.component('kanban-col-a', {
                state: {
                    _version: 0  // Used to trigger re-renders
                },
                computed: {
                    cards() {
                        const store = wildflower.getStore('kanban');
                        if (!store) return [];
                        const cards = store.state.columnA || [];
                        // Column A is first - no move left
                        return cards.map(c => ({ ...c, canMoveLeft: false }));
                    }
                },
                // Subscribe to store changes to auto-update
                subscribe: {
                    kanban: ['columnA']
                }
            });

            // Column B - cards can move left (not first column)
            wildflower.component('kanban-col-b', {
                state: {
                    _version: 0
                },
                computed: {
                    cards() {
                        const store = wildflower.getStore('kanban');
                        if (!store) return [];
                        const cards = store.state.columnB || [];
                        // Column B is second - can move left
                        return cards.map(c => ({ ...c, canMoveLeft: true }));
                    }
                },
                // Subscribe to store changes to auto-update
                subscribe: {
                    kanban: ['columnB']
                }
            });

            await waitForCompleteRender();

            const colA = testContainer.querySelector('.col-a');
            const colB = testContainer.querySelector('.col-b');
            const listA = colA.querySelector('.card-list');
            const listB = colB.querySelector('.card-list');

            // Initial: Column A has 2 cards without move-left, Column B has 1 card with move-left
            expect(getListItems(listA).length).toBe(2);
            expect(getListItems(listB).length).toBe(1);

            const card1 = listA.querySelector('.card[data-card-id="1"]');
            const card3 = listB.querySelector('.card[data-card-id="3"]');

            // Card 1 is in Column A - no move-left (hidden via style.display)
            expect(card1.querySelector('.move-left').style.display).toBe('none');
            // Card 3 is in Column B - has move-left (visible - display is empty string)
            expect(card3.querySelector('.move-left').style.display).toBe('');

            // Simulate SortableJS: physically move card1 element to Column B's list
            listB.appendChild(card1);

            // Now trigger the store update (as SortableJS onEnd would do)
            const store = wildflower.getStore('kanban');
            store.moveCard(1, 'columnA', 'columnB');

            // Wait for framework to process the update
            await waitForCompleteRender();
            await waitForUpdate(200);

            // After the update, card1 should now have move-left visible
            // because it's now in Column B where canMoveLeft is true
            const movedCard1 = listB.querySelector('.card[data-card-id="1"]');
            expect(movedCard1).toBeTruthy();

            // Debug: log the state of the element (avoid Symbols for serialization)
            console.log('Card1 in listB:', movedCard1?.outerHTML);
            console.log('Card1 _listContext id:', movedCard1?._listContext?.id);
            console.log('Card1 _itemData id:', movedCard1?._itemData?.id, 'canMoveLeft:', movedCard1?._itemData?.canMoveLeft);
            const moveLeftBtn = movedCard1.querySelector('.move-left');
            console.log('Move-left style.display:', moveLeftBtn?.style.display);

            // After rebinding, the move-left button should be visible (empty display)
            expect(movedCard1.querySelector('.move-left').style.display).toBe('');

            // Column A should now have only 1 card
            expect(getListItems(listA).length).toBe(1);
            // Column B should now have 2 cards
            expect(getListItems(listB).length).toBe(2);
        });
    });
});
