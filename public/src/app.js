'use strict';

if (!window.d3) {
            const container = document.getElementById('tree-container');
            container.innerHTML = '<div style="padding:24px;font-family:Inter,system-ui,sans-serif;color:#dc3545;font-weight:700;">D3 failed to load. Connect to the internet or run this from a local copy that includes D3.</div>';
            throw new Error('D3 failed to load');
        }

        // ===== APP STATE =====
        let terms = [];
        let clickedNode = null;
        let focusedNode = null;
        let currentSidebarNode = null;
        let nodeByName = {};
        let noticeTimer = null;
        let quizQuestions = [];
        let activeQuizQuestions = [];
        let quizIndex = 0;
        let selectedOptionIndex = null;
        let activeTopicFilter = 'All';
        let activeCategoryFilter = 'All';
        let accountingQuizCsvText = '';
        let accountingMapCsvText = '';
        let accountingQuizSourceName = 'accounting_quiz.csv';
        let accountingMapSourceName = 'accounting_map.csv';
        let currentView = 'quiz';
        let quizAnswers = [];
        let quizFinished = false;
        let freezeQuizTabs = false;
        let practiceLoaded = false;
        let practiceExercises = [];
        let activePracticeExercises = [];
        let practiceIndex = 0;
        let activePracticeTopic = 'All';
        let practiceScoreCorrect = 0;
        let practiceScoreTotal = 0;
        let practiceDraggedEl = null;
        let practiceFinished = false;

        function showNotice(message, isError = false) {
            const notice = document.getElementById('notice');
            notice.textContent = message;
            notice.classList.toggle('error', isError);
            notice.classList.add('visible');

            if (noticeTimer) {
                clearTimeout(noticeTimer);
            }

            noticeTimer = setTimeout(() => {
                notice.classList.remove('visible');
            }, isError ? 8000 : 4200);
        }

        function normalizeHeader(value) {
            return value.toLowerCase().trim().replace(/[\s_-]+/g, '');
        }

        function escapeHTML(value) {
            return String(value || '').replace(/[&<>"']/g, char => ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;'
            }[char]));
        }

        function getActiveRoots() {
            return focusedNode ? [focusedNode] : forestRoots;
        }

        function forEachNode(roots, callback) {
            function visit(node) {
                callback(node);
                node.children.forEach(visit);
            }

            roots.forEach(visit);
        }

        function attachRouteHandlers() {
            document.querySelectorAll('.route-chip').forEach(chip => {
                chip.addEventListener('click', event => {
                    const node = nodeByName[event.currentTarget.dataset.term];
                    if (!node) return;
                    toggleFocusedNode(node, focusedNode !== node);
                });
            });
        }

        // ===== ROBUST CSV PARSER =====
        // Handles: multi-line quoted fields, embedded commas, embedded quotes
        function parseCSVRobust(csvText) {
            const rows = [];
            let currentRow = [];
            let currentField = '';
            let inQuotes = false;
            let i = 0;

            while (i < csvText.length) {
                const char = csvText[i];
                const nextChar = csvText[i + 1];

                if (inQuotes) {
                    if (char === '"') {
                        if (nextChar === '"') {
                            // Escaped quote
                            currentField += '"';
                            i += 2;
                        } else {
                            // End of quoted field
                            inQuotes = false;
                            i++;
                        }
                    } else {
                        currentField += char;
                        i++;
                    }
                } else {
                    if (char === '"') {
                        // Start of quoted field
                        inQuotes = true;
                        i++;
                    } else if (char === ',') {
                        // End of field
                        currentRow.push(currentField);
                        currentField = '';
                        i++;
                    } else if (char === '\r' || char === '\n') {
                        // End of row
                        if (char === '\r' && nextChar === '\n') {
                            i += 2; // Windows line ending
                        } else {
                            i++;
                        }
                        currentRow.push(currentField);
                        if (currentRow.length > 1 || currentRow[0] !== '' || currentField !== '') {
                            // Skip empty rows
                            const nonEmpty = currentRow.some(f => f.trim() !== '');
                            if (nonEmpty) {
                                rows.push(currentRow);
                            }
                        }
                        currentRow = [];
                        currentField = '';
                    } else {
                        currentField += char;
                        i++;
                    }
                }
            }

            // Handle last row if file doesn't end with newline
            if (currentField !== '' || currentRow.length > 0) {
                currentRow.push(currentField);
                const nonEmpty = currentRow.some(f => f.trim() !== '');
                if (nonEmpty) {
                    rows.push(currentRow);
                }
            }

            return rows;
        }

        // ===== ACCOUNTING CSV =====
        async function fetchAccountingCSV(endpoint, sourceName) {
            const response = await fetch(endpoint, { cache: 'no-store' });
            if (!response.ok) {
                throw new Error(`${sourceName}: server returned ${response.status}`);
            }
            return response.text();
        }

        async function loadAccountingQuizCSV() {
            try {
                const sourceName = 'accounting_quiz.csv';
                const csv = await fetchAccountingCSV('/api/accounting-quiz-csv', sourceName);
                const rows = parseCSVRobust(csv);
                const hasQuizRows = parseQuizRows(rows).length > 0;
                const hasTermRows = extractTermsFromRows(rows).length > 0;

                if (!hasQuizRows && !hasTermRows) {
                    showNotice(`${sourceName} has no usable quiz or term rows.`, true);
                    return;
                }

                accountingQuizCsvText = csv;
                accountingQuizSourceName = sourceName;
                loadAccountingQuiz(csv, sourceName);
            } catch (error) {
                showNotice(`Could not load accounting quiz data. ${error.message}`, true);
            }
        }

        async function loadAccountingMapCSV() {
            try {
                const sourceName = 'accounting_map.csv';
                const csv = await fetchAccountingCSV('/api/accounting-map-csv', sourceName);
                const rows = parseCSVRobust(csv);

                if (extractMapTerms(rows).length === 0) {
                    showNotice(`${sourceName} has no usable mindmap rows. CSV needs term, definition, and branch columns.`, true);
                    return '';
                }

                accountingMapCsvText = csv;
                accountingMapSourceName = sourceName;
                return accountingMapCsvText;
            } catch (error) {
                showNotice(`Could not load accounting map data. ${error.message}`, true);
                return '';
            }
        }

        function loadAccountingQuiz(csvText, sourceName = 'accounting_quiz.csv') {
            const rows = parseCSVRobust(csvText);
            quizQuestions = parseQuizRows(rows);

            if (quizQuestions.length === 0) {
                quizQuestions = buildQuizFromTerms(rows);
            }

            if (quizQuestions.length === 0) {
                showNotice(`No usable quiz rows found in ${sourceName}.`, true);
                return;
            }

            currentView = 'quiz';
            document.body.classList.add('quiz-mode');
            document.body.classList.remove('practice-mode');
            document.querySelector('.file-name').textContent = sourceName;
            setViewButtons();
            activeTopicFilter = 'All';
            activeCategoryFilter = 'All';
            quizIndex = 0;
            selectedOptionIndex = null;
            quizFinished = false;
            freezeQuizTabs = false;
            setViewButtons();
            applyQuizFilters();
            showNotice(`Loaded ${quizQuestions.length} accounting question${quizQuestions.length === 1 ? '' : 's'}.`);
        }

        function switchToQuiz() {
            if (accountingQuizCsvText) {
                loadAccountingQuiz(accountingQuizCsvText, accountingQuizSourceName);
            } else {
                loadAccountingQuizCSV();
            }
        }

        async function switchToMindmap() {
            if (freezeQuizTabs) {
                showNotice('Tabs are frozen. Use Pick topics or turn off Freeze tabs first.');
                return;
            }

            if (!accountingMapCsvText) {
                const csv = await loadAccountingMapCSV();
                if (!csv) return;
            }

            if (!accountingMapCsvText) {
                return;
            }

            currentView = 'mindmap';
            document.body.classList.remove('quiz-mode');
            document.body.classList.remove('practice-mode');
            setViewButtons();
            initializeTreeCanvas();
            parseCSV(accountingMapCsvText, accountingMapSourceName);
            clearSidebar();
        }

        function setViewButtons() {
            document.getElementById('quiz-view-button').classList.toggle('active', currentView === 'quiz');
            document.getElementById('mindmap-view-button').classList.toggle('active', currentView === 'mindmap');
            document.getElementById('practice-view-button').classList.toggle('active', currentView === 'practice');
            document.getElementById('mindmap-view-button').disabled = freezeQuizTabs && currentView === 'quiz';
        }

        function parseQuizRows(rows) {
            if (rows.length < 2) return [];

            const headers = rows[0].map(normalizeHeader);
            const headerMap = {};
            headers.forEach((header, idx) => {
                headerMap[header] = idx;
            });

            const required = ['topic', 'category', 'question', 'option', 'iscorrect', 'explanation'];
            if (!required.every(header => header in headerMap)) return [];

            const questionMap = new Map();

            rows.slice(1).forEach(row => {
                const question = (row[headerMap.question] || '').trim();
                const option = (row[headerMap.option] || '').trim();
                if (!question || !option) return;

                const topic = (row[headerMap.topic] || 'Accounting').trim() || 'Accounting';
                const category = (row[headerMap.category] || topic).trim() || topic;
                const explanation = (row[headerMap.explanation] || '').trim();
                const isCorrectValue = String(row[headerMap.iscorrect] || '').trim().toLowerCase();
                const isCorrect = ['true', 't', 'yes', 'y', '1', 'correct'].includes(isCorrectValue);
                const key = `${topic}||${category}||${question}`;

                if (!questionMap.has(key)) {
                    questionMap.set(key, {
                        topic,
                        category,
                        question,
                        options: [],
                        correctIndex: -1,
                        explanation
                    });
                }

                const item = questionMap.get(key);
                if (explanation && !item.explanation) item.explanation = explanation;
                if (isCorrect) item.correctIndex = item.options.length;
                item.options.push(option);
            });

            return Array.from(questionMap.values()).filter(item => item.options.length >= 2 && item.correctIndex >= 0);
        }

        function buildQuizFromTerms(rows) {
            const termsFromCsv = extractTermsFromRows(rows);
            if (termsFromCsv.length < 2) return [];

            return termsFromCsv.map((term, index) => {
                const distractors = termsFromCsv
                    .filter(candidate => candidate.definition && candidate.term !== term.term)
                    .sort((a, b) => {
                        const aScore = candidateCategoryScore(term, a);
                        const bScore = candidateCategoryScore(term, b);
                        return bScore - aScore;
                    })
                    .slice(0, 3)
                    .map(candidate => candidate.definition);

                const options = [term.definition, ...distractors].filter(Boolean).slice(0, 4);
                const rotated = rotateOptions(options, index);
                const correctIndex = rotated.indexOf(term.definition);

                return {
                    topic: term.topic,
                    category: term.category,
                    question: `Which description best matches ${term.term}?`,
                    options: rotated,
                    correctIndex,
                    explanation: term.example
                        ? `${term.term}: ${term.definition} Example: ${term.example}`
                        : `${term.term}: ${term.definition}`
                };
            }).filter(item => item.options.length >= 2 && item.correctIndex >= 0);
        }

        function extractTermsFromRows(rows) {
            const termsFromCsv = [];
            let startIdx = 0;
            let termIdx = 0;
            let definitionIdx = 1;
            let branchIdx = 3;
            let exampleIdx = 2;

            if (rows.length > 0) {
                const firstRow = rows[0].map(normalizeHeader);
                const headerMap = {};
                firstRow.forEach((header, idx) => {
                    headerMap[header] = idx;
                });

                const hasHeader = ['term', 'definition', 'branch', 'example'].some(header => header in headerMap);
                if (hasHeader) {
                    startIdx = 1;
                    termIdx = headerMap.term ?? headerMap.name ?? 0;
                    definitionIdx = headerMap.definition ?? headerMap.def ?? 1;
                    branchIdx = headerMap.branch ?? headerMap.parent ?? headerMap.path ?? 3;
                    exampleIdx = headerMap.example ?? headerMap.examples ?? 2;
                }
            }

            for (let i = startIdx; i < rows.length; i++) {
                const parts = rows[i];
                const term = (parts[termIdx] || '').trim();
                const definition = (parts[definitionIdx] || '').trim();
                const branch = (parts[branchIdx] || 'Accounting').trim() || 'Accounting';
                const example = (parts[exampleIdx] || '').trim();
                const path = branch.split('>').map(part => part.trim()).filter(Boolean);
                const topic = path[0] && path[0] !== 'Root' ? path[0] : 'Accounting';
                const category = path.length > 1 ? path[path.length - 1] : topic;

                if (term && definition) {
                    termsFromCsv.push({ term, definition, example, branch, topic, category });
                }
            }

            return termsFromCsv;
        }

        function candidateCategoryScore(base, candidate) {
            let score = 0;
            if (base.topic === candidate.topic) score += 2;
            if (base.category === candidate.category) score += 3;
            return score;
        }

        function rotateOptions(options, offset) {
            const unique = [];
            options.forEach(option => {
                if (!unique.includes(option)) unique.push(option);
            });
            if (unique.length <= 1) return unique;
            const shift = offset % unique.length;
            return unique.slice(shift).concat(unique.slice(0, shift));
        }

        function applyQuizFilters() {
            activeQuizQuestions = quizQuestions.filter(question => {
                const topicMatch = activeTopicFilter === 'All' || question.topic === activeTopicFilter;
                const categoryMatch = activeCategoryFilter === 'All' || question.category === activeCategoryFilter;
                return topicMatch && categoryMatch;
            });

            if (activeQuizQuestions.length === 0) {
                activeQuizQuestions = quizQuestions;
                activeTopicFilter = 'All';
                activeCategoryFilter = 'All';
            }

            quizIndex = Math.min(quizIndex, Math.max(0, activeQuizQuestions.length - 1));
            selectedOptionIndex = null;
            quizAnswers = Array(activeQuizQuestions.length).fill(null);
            quizFinished = false;
            renderQuizSidebar();
            renderQuizQuestion();
        }

        function renderQuizSidebar() {
            const sidebarContent = document.getElementById('sidebar-content');
            const topics = ['All', ...Array.from(new Set(quizQuestions.map(question => question.topic))).sort()];
            const categories = ['All', ...Array.from(new Set(
                quizQuestions
                    .filter(question => activeTopicFilter === 'All' || question.topic === activeTopicFilter)
                    .map(question => question.category)
            )).sort()];

            sidebarContent.innerHTML = `
                <div class="quiz-nav">
                    <div class="quiz-tools">
                        <label class="quiz-lock">
                            <input id="freeze-tabs-toggle" type="checkbox" ${freezeQuizTabs ? 'checked' : ''}>
                            <span>Freeze tabs</span>
                        </label>
                        <div class="quiz-tool-row">
                            <button id="reset-quiz-button" class="quiz-tool-button" type="button">Reset quiz</button>
                            <button id="shuffle-quiz-button" class="quiz-tool-button" type="button">Shuffle</button>
                        </div>
                        <div class="quiz-tool-row">
                            <button id="clear-topics-button" class="quiz-tool-button" type="button">Clear topics</button>
                            <button id="pick-topics-button" class="quiz-tool-button" type="button">Pick topics</button>
                        </div>
                    </div>
                    <div class="quiz-nav-section">
                        <div class="quiz-nav-label">Topics</div>
                        ${topics.map(topic => buildFilterButton('topic', topic, activeTopicFilter === topic)).join('')}
                    </div>
                    <div class="quiz-nav-section">
                        <div class="quiz-nav-label">Categories</div>
                        ${categories.map(category => buildFilterButton('category', category, activeCategoryFilter === category)).join('')}
                    </div>
                </div>
            `;

            document.getElementById('freeze-tabs-toggle').addEventListener('change', event => {
                freezeQuizTabs = event.currentTarget.checked;
                setViewButtons();
                renderQuizSidebar();
                showNotice(freezeQuizTabs ? 'Tabs and topic filters are frozen.' : 'Tabs and topic filters are unlocked.');
            });
            document.getElementById('reset-quiz-button').addEventListener('click', resetQuizSession);
            document.getElementById('shuffle-quiz-button').addEventListener('click', shuffleQuizCards);
            document.getElementById('clear-topics-button').addEventListener('click', clearQuizTopics);
            document.getElementById('pick-topics-button').addEventListener('click', pickQuizTopics);

            sidebarContent.querySelectorAll('.quiz-filter').forEach(button => {
                button.addEventListener('click', event => {
                    if (freezeQuizTabs) {
                        showNotice('Topic filters are frozen. Use Pick topics or turn off Freeze tabs first.');
                        return;
                    }

                    const type = event.currentTarget.dataset.type;
                    const value = event.currentTarget.dataset.value;
                    if (type === 'topic') {
                        activeTopicFilter = value;
                        activeCategoryFilter = 'All';
                    } else {
                        activeCategoryFilter = value;
                    }
                    quizIndex = 0;
                    applyQuizFilters();
                });
            });
        }

        function buildFilterButton(type, value, isActive) {
            const count = quizQuestions.filter(question => {
                if (type === 'topic') return value === 'All' || question.topic === value;
                const topicMatch = activeTopicFilter === 'All' || question.topic === activeTopicFilter;
                return (value === 'All' || question.category === value) && topicMatch;
            }).length;

            return `
                <button class="quiz-filter ${isActive ? 'active' : ''}" type="button" data-type="${type}" data-value="${escapeHTML(value)}" ${freezeQuizTabs ? 'disabled' : ''}>
                    <span>${escapeHTML(value)}</span>
                    <span>${count}</span>
                </button>
            `;
        }

        function resetQuizSession() {
            quizIndex = 0;
            selectedOptionIndex = null;
            quizAnswers = Array(activeQuizQuestions.length).fill(null);
            quizFinished = false;
            renderQuizSidebar();
            renderQuizQuestion();
            showNotice('Quiz reset.');
        }

        function shuffleQuizCards() {
            if (activeQuizQuestions.length <= 1) {
                showNotice('Need at least two cards to shuffle.');
                return;
            }

            activeQuizQuestions = shuffleArray(activeQuizQuestions);
            quizIndex = 0;
            selectedOptionIndex = null;
            quizAnswers = Array(activeQuizQuestions.length).fill(null);
            quizFinished = false;
            renderQuizQuestion();
            showNotice(`Shuffled ${activeQuizQuestions.length} quiz cards.`);
        }

        function shuffleArray(items) {
            const shuffled = items.slice();
            for (let i = shuffled.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }
            return shuffled;
        }

        function clearQuizTopics() {
            freezeQuizTabs = false;
            activeTopicFilter = 'All';
            activeCategoryFilter = 'All';
            quizIndex = 0;
            selectedOptionIndex = null;
            setViewButtons();
            applyQuizFilters();
            showNotice('Topic filters cleared.');
        }

        function pickQuizTopics() {
            freezeQuizTabs = false;
            setViewButtons();
            renderQuizSidebar();
            showNotice('Topic filters are unlocked.');
        }

        function renderQuizQuestion() {
            if (activeQuizQuestions.length === 0) return;
            if (quizFinished) {
                renderQuizScore();
                return;
            }

            const container = document.getElementById('tree-container');
            const question = activeQuizQuestions[quizIndex];
            const progress = ((quizIndex + 1) / activeQuizQuestions.length) * 100;
            const savedAnswer = quizAnswers[quizIndex];

            document.getElementById('route-bar').innerHTML = '';

            container.innerHTML = `
                <main class="quiz-shell">
                    <div class="quiz-progress-track">
                        <div class="quiz-progress-fill" style="width: ${progress}%"></div>
                    </div>
                    <div class="quiz-meta">
                        <div class="quiz-pill">${escapeHTML(question.category || question.topic)}</div>
                        <div class="quiz-count">${quizIndex + 1} of ${activeQuizQuestions.length}</div>
                    </div>
                    <h1 class="quiz-question">${escapeHTML(question.question)}</h1>
                    <div class="quiz-options">
                        ${question.options.map((option, idx) => `
                            <button class="quiz-option ${getOptionClass(question, savedAnswer, idx)}" type="button" data-index="${idx}">
                                ${String.fromCharCode(65 + idx)}. ${escapeHTML(option)}
                            </button>
                        `).join('')}
                    </div>
                    <div id="quiz-feedback" class="quiz-feedback ${savedAnswer === null ? '' : `visible ${savedAnswer === question.correctIndex ? 'correct' : 'incorrect'}`}" aria-live="polite">
                        ${savedAnswer === null ? '' : buildFeedbackHTML(question, savedAnswer === question.correctIndex)}
                    </div>
                    <div class="quiz-footer">
                        <button id="quiz-shuffle" class="quiz-nav-button" type="button">Shuffle</button>
                        <button id="quiz-prev" class="quiz-nav-button" type="button" ${quizIndex === 0 ? 'disabled' : ''}>Previous</button>
                        <button id="quiz-next" class="quiz-nav-button primary" type="button">${quizIndex === activeQuizQuestions.length - 1 ? 'Finish' : 'Next'}</button>
                    </div>
                </main>
            `;

            container.querySelectorAll('.quiz-option').forEach(button => {
                button.addEventListener('click', event => selectQuizOption(Number(event.currentTarget.dataset.index)));
            });
            document.getElementById('quiz-shuffle').addEventListener('click', shuffleQuizCards);
            document.getElementById('quiz-prev').addEventListener('click', () => moveQuiz(-1));
            document.getElementById('quiz-next').addEventListener('click', () => moveQuiz(1));
        }

        function getOptionClass(question, savedAnswer, optionIndex) {
            if (savedAnswer === null) return '';
            const classes = [];
            if (optionIndex === savedAnswer) classes.push('selected');
            if (optionIndex === question.correctIndex) classes.push('correct');
            if (optionIndex === savedAnswer && savedAnswer !== question.correctIndex) classes.push('incorrect');
            return classes.join(' ');
        }

        function buildFeedbackHTML(question, isCorrect) {
            return `<strong>${isCorrect ? 'Correct.' : 'Not quite.'}</strong> ${escapeHTML(question.explanation || 'Review the matching accounting concept and try the next one.')}`;
        }

        function selectQuizOption(index) {
            selectedOptionIndex = index;
            quizAnswers[quizIndex] = index;
            const question = activeQuizQuestions[quizIndex];
            const isCorrect = index === question.correctIndex;
            const feedback = document.getElementById('quiz-feedback');

            document.querySelectorAll('.quiz-option').forEach((button, idx) => {
                button.classList.toggle('selected', idx === index);
                button.classList.toggle('correct', idx === question.correctIndex);
                button.classList.toggle('incorrect', idx === index && !isCorrect);
            });

            feedback.className = `quiz-feedback visible ${isCorrect ? 'correct' : 'incorrect'}`;
            feedback.innerHTML = buildFeedbackHTML(question, isCorrect);
        }

        function moveQuiz(direction) {
            if (direction > 0 && quizIndex >= activeQuizQuestions.length - 1) {
                quizFinished = true;
                renderQuizScore();
                return;
            } else {
                quizIndex = Math.max(0, Math.min(activeQuizQuestions.length - 1, quizIndex + direction));
            }
            selectedOptionIndex = quizAnswers[quizIndex];
            renderQuizQuestion();
        }

        function getQuizScore() {
            return quizAnswers.reduce((score, answer, index) => {
                return score + (answer === activeQuizQuestions[index].correctIndex ? 1 : 0);
            }, 0);
        }

        function renderQuizScore() {
            const container = document.getElementById('tree-container');
            const score = getQuizScore();
            const total = activeQuizQuestions.length;
            const answered = quizAnswers.filter(answer => answer !== null).length;
            const percent = total ? Math.round((score / total) * 100) : 0;

            document.getElementById('route-bar').innerHTML = '';
            container.innerHTML = `
                <main class="quiz-shell score-shell">
                    <div class="quiz-progress-track">
                        <div class="quiz-progress-fill" style="width: 100%"></div>
                    </div>
                    <section class="score-card">
                        <div class="score-label">Score</div>
                        <div class="score-value">${score} / ${total}</div>
                        <div class="score-percent">${percent}% correct</div>
                        <div class="score-detail">${answered} of ${total} question${total === 1 ? '' : 's'} answered</div>
                        <div class="score-actions">
                            <button id="score-reset-button" class="quiz-nav-button primary" type="button">Reset quiz</button>
                            <button id="score-shuffle-button" class="quiz-nav-button" type="button">Shuffle</button>
                            <button id="score-topics-button" class="quiz-nav-button" type="button">Pick topics</button>
                        </div>
                    </section>
                </main>
            `;

            document.getElementById('score-reset-button').addEventListener('click', resetQuizSession);
            document.getElementById('score-shuffle-button').addEventListener('click', shuffleQuizCards);
            document.getElementById('score-topics-button').addEventListener('click', pickQuizTopics);
        }

        function parseCSV(csvText, sourceName = 'CSV') {
            const rows = parseCSVRobust(csvText);
            const newTerms = extractMapTerms(rows);

            if (newTerms.length > 0) {
                terms = newTerms;
                clickedNode = null;
                focusedNode = null;
                rebuildTree();
                document.querySelector('.file-name').textContent = sourceName;
                showNotice(`Imported ${newTerms.length} term${newTerms.length === 1 ? '' : 's'} from ${sourceName}.`);
            } else {
                showNotice(`No usable rows found in ${sourceName}. CSV needs term, definition, and branch columns.`, true);
            }
        }

        function extractMapTerms(rows) {
            const newTerms = [];

            let startIdx = 0;
            let termIdx = 0;
            let definitionIdx = 1;
            let branchIdx = 2;
            let exampleIdx = 3;

            if (rows.length > 0) {
                const firstRow = rows[0].map(normalizeHeader);
                const headerMap = {};
                firstRow.forEach((header, idx) => {
                    headerMap[header] = idx;
                });

                const hasHeader = ['term', 'definition', 'branch', 'example'].some(header => header in headerMap);
                const hasQuizHeader = ['topic', 'category', 'question', 'option', 'iscorrect'].some(header => header in headerMap);
                if (hasQuizHeader && !hasHeader) {
                    return [];
                }

                if (hasHeader) {
                    startIdx = 1;
                    termIdx = headerMap.term ?? headerMap.name ?? 0;
                    definitionIdx = headerMap.definition ?? headerMap.def ?? 1;
                    branchIdx = headerMap.branch ?? headerMap.parent ?? headerMap.path ?? 2;
                    exampleIdx = headerMap.example ?? headerMap.examples ?? 3;
                }
            }

            for (let i = startIdx; i < rows.length; i++) {
                const parts = rows[i];
                if (parts.length > Math.max(termIdx, definitionIdx, branchIdx)) {
                    const term = (parts[termIdx] || '').trim();
                    const definition = (parts[definitionIdx] || '').trim();
                    const branch = (parts[branchIdx] || 'Root').trim() || 'Root';
                    const example = (parts[exampleIdx] || '').trim();
                    
                    if (term) {
                        newTerms.push({ term, definition, example, branch });
                    }
                }
            }

            return newTerms;
        }

        // ===== BUILD FOREST =====
        function buildForest() {
            const nodeMap = {};
            const roots = [];
            const rootSet = new Set();
            nodeByName = nodeMap;

            for (const t of terms) {
                nodeMap[t.term] = {
                    name: t.term,
                    definition: t.definition,
                    example: t.example || '',
                    branch: t.branch,
                    children: [],
                    _collapsed: true,
                    _parent: null
                };
            }

            for (const t of terms) {
                const node = nodeMap[t.term];
                const parts = t.branch.split(">");

                if (parts[0].trim() === "Root") {
                    if (!rootSet.has(node.name)) {
                        roots.push(node);
                        rootSet.add(node.name);
                    }
                } else {
                    const parentName = parts[parts.length - 1].trim();
                    if (nodeMap[parentName]) {
                        nodeMap[parentName].children.push(node);
                        node._parent = nodeMap[parentName];
                    } else {
                        console.warn(`Parent not found for "${t.term}": looking for "${parentName}"`);
                        if (!rootSet.has(node.name)) {
                            roots.push(node);
                            rootSet.add(node.name);
                        }
                    }
                }
            }

            return roots;
        }

        let forestRoots = buildForest();

        function updateRootPositions() {
            const newWidth = treePanel.clientWidth;
            const newHeight = treePanel.clientHeight;
            const activeRoots = getActiveRoots();
            rootPositions.length = 0;

            if (activeRoots.length === 0) {
                rootPositions.push({ x: newWidth * 0.5, y: newHeight * 0.5 });
                return;
            }

            if (activeRoots.length === 1) {
                rootPositions.push({ x: newWidth * 0.5, y: newHeight * 0.5 });
                return;
            }

            const centerX = newWidth * 0.5;
            const centerY = newHeight * 0.5;
            const spread = getRootSpread(activeRoots.length);

            activeRoots.forEach((root, idx) => {
                const angle = (-Math.PI / 2) + ((Math.PI * 2 * idx) / activeRoots.length);
                rootPositions.push({
                    x: centerX + spread * Math.cos(angle),
                    y: centerY + spread * Math.sin(angle)
                });
            });
        }

        // ===== REBUILD TREE AFTER IMPORT =====
        function rebuildTree() {
            nodeId = 0;
            forestRoots = buildForest();
            updateRootPositions();

            getActiveRoots().forEach((r, i) => assignIds(r, 0, i));

            render();
            setTimeout(centerOnRoots, 50);
        }

        // ===== LAYOUT =====
        const treePanel = document.getElementById('tree-panel');
        const container = document.getElementById('tree-container');
        const width = treePanel.clientWidth;
        const height = treePanel.clientHeight;

        let svg = null;
        let zoom = null;
        let g = null;

        function initializeTreeCanvas() {
            container.innerHTML = '';
            svg = d3.select("#tree-container").append("svg")
                .attr("width", treePanel.clientWidth || width)
                .attr("height", treePanel.clientHeight || height);

            zoom = d3.zoom()
                .scaleExtent([0.15, 4])
                .on("zoom", (event) => {
                    if (g) g.attr("transform", event.transform);
                });

            svg.call(zoom);
            g = svg.append("g");
        }

        const rootPositions = [
            { x: width * 0.32, y: height * 0.5 },
            { x: width * 0.68, y: height * 0.5 }
        ];

        let visibleBounds = null;

        function getLayoutMetrics() {
            const panelWidth = treePanel.clientWidth || width || 1000;
            const isMobile = panelWidth <= 800;

            return {
                baseSize: isMobile ? 42 : 52,
                halfSize: isMobile ? 24 : 28,
                ringSpacing: isMobile ? 150 : 205,
                siblingGap: isMobile ? 0.03 : 0.045,
                maxScale: isMobile ? 1.15 : 1.5
            };
        }

        function getRootSpread(rootCount) {
            const panelWidth = treePanel.clientWidth || width || 1000;
            const panelHeight = treePanel.clientHeight || height || 700;
            const minSpread = panelWidth <= 800 ? 180 : 260;
            const countBoost = Math.max(0, rootCount - 2) * 34;
            return Math.max(minSpread + countBoost, Math.min(panelWidth, panelHeight) * 0.32);
        }

        let nodeId = 0;
        function assignIds(node, depth, rootIdx) {
            node._id = ++nodeId;
            node._depth = depth;
            node._rootIndex = rootIdx;
            node._visibleChildren = node._collapsed ? [] : node.children;
            node.children.forEach(c => assignIds(c, depth + 1, rootIdx));
        }
        updateRootPositions();
        getActiveRoots().forEach((r, i) => assignIds(r, 0, i));

        // ===== COMPUTE DEEPEST VISIBLE LEVEL =====
        function getDeepestVisibleLevel() {
            let maxDepth = 0;

            function traverse(node, depth) {
                if (!node._collapsed && node.children && node.children.length > 0) {
                    node.children.forEach(child => {
                        maxDepth = Math.max(maxDepth, depth + 1);
                        traverse(child, depth + 1);
                    });
                }
            }

            getActiveRoots().forEach(root => traverse(root, 0));
            return maxDepth;
        }

        function getNodeSize(node, deepestLevel) {
            const { baseSize, halfSize } = getLayoutMetrics();
            if (node._depth === deepestLevel) {
                return halfSize;
            }
            return baseSize;
        }

        // ===== CENTER VIEW ON A NODE =====
        function centerOnNode(node, duration = 600) {
            const fullWidth = treePanel.clientWidth;
            const fullHeight = treePanel.clientHeight;
            const scale = 1.0;
            const translate = [fullWidth / 2 - scale * node._x, fullHeight / 2 - scale * node._y];

            const transform = d3.zoomIdentity
                .translate(translate[0], translate[1])
                .scale(scale);

            svg.transition().duration(duration).call(zoom.transform, transform);
        }

        // ===== SIDEBAR: Build Obsidian-style outline =====
        function getHierarchyPath(node) {
            const path = [];
            let current = node;
            while (current) {
                path.unshift(current);
                current = current._parent;
            }
            return path;
        }

        function buildOutlineHTML(node, targetNode, depth = 0) {
            const path = getHierarchyPath(targetNode);
            const isInPath = path.includes(node);
            const isTarget = node === targetNode;
            const hasChildren = node.children && node.children.length > 0;

            let html = '';

            const itemClass = isTarget ? 'outline-item current' : 'outline-item';
            html += `<div class="${itemClass}">`;

            for (let i = 0; i < depth; i++) {
                html += `<div class="indent"></div>`;
            }

            html += `<div class="bullet-wrap"><div class="bullet"></div></div>`;
            html += `<div class="text">${escapeHTML(node.name)}</div>`;
            html += `</div>`;

            if (hasChildren && isInPath) {
                node.children.forEach(child => {
                    html += buildOutlineHTML(child, targetNode, depth + 1);
                });
            }

            return html;
        }

        function toggleFocusedNode(node, shouldFocus) {
            const targetNode = node || currentSidebarNode || clickedNode || focusedNode;
            if (!targetNode) return;

            focusedNode = shouldFocus ? targetNode : null;
            if (focusedNode && focusedNode.children.length > 0) {
                focusedNode._collapsed = false;
            }
            nodeId = 0;
            updateRootPositions();
            getActiveRoots().forEach((root, idx) => assignIds(root, 0, idx));
            render();
            updateSidebar(targetNode, false);
            updateRouteBar(targetNode);
            setTimeout(centerOnRoots, 80);
            showNotice(shouldFocus ? `Showing ${targetNode.name} as the top node.` : 'Restored the full tree.');
        }

        function clearFocusedNode() {
            toggleFocusedNode(focusedNode || currentSidebarNode, false);
        }

        function updateRouteBar(targetNode) {
            const routeBar = document.getElementById('route-bar');
            if (!targetNode) {
                routeBar.innerHTML = '';
                return;
            }

            const path = getHierarchyPath(targetNode);
            const cutIndex = focusedNode ? path.indexOf(focusedNode) : -1;
            routeBar.innerHTML = path.map((node, idx) => {
                const separator = idx < path.length - 1 ? '<span class="route-separator">&gt;</span>' : '';
                const isCutAway = cutIndex >= 0 && idx <= cutIndex;
                return `
                    <button
                        class="route-chip ${isCutAway ? 'cut-away' : ''}"
                        type="button"
                        data-term="${escapeHTML(node.name)}"
                        title="${isCutAway ? 'Restore full tree' : `Cut tree at ${escapeHTML(node.name)}`}"
                    >${escapeHTML(node.name)}</button>
                    ${separator}
                `;
            }).join('');
            attachRouteHandlers();
        }

        function updateSidebar(node, isClick = false) {
            const sidebarContent = document.getElementById('sidebar-content');

            let targetNode = node;
            if (isClick) clickedNode = node;
            currentSidebarNode = targetNode;

            let targetRoot = null;
            if (focusedNode && getHierarchyPath(targetNode).includes(focusedNode)) {
                targetRoot = focusedNode;
            }

            for (const root of forestRoots) {
                if (targetRoot) break;
                if (getHierarchyPath(targetNode).includes(root)) {
                    targetRoot = root;
                    break;
                }
            }

            if (!targetRoot) return;

            let html = '<div class="outline-list">';
            html += buildOutlineHTML(targetRoot, targetNode);
            html += '</div>';

            html += `<div class="definition-section">`;
            html += `<div class="def-label">Definition</div>`;
            html += `<div class="def-term">${escapeHTML(targetNode.name)}</div>`;
            html += `<div class="def-text">${escapeHTML(targetNode.definition || 'No definition available.')}</div>`;
            if (targetNode.example && targetNode.example.trim()) {
                html += `<div class="def-example-label">Example</div>`;
                html += `<div class="def-example" id="def-example-content"></div>`;
            }
            html += `<div class="def-branch">${escapeHTML((targetNode.branch || 'Root').replace(/>/g, ' > '))}</div>`;
            html += `</div>`;

            sidebarContent.innerHTML = html;
            const exEl = document.getElementById('def-example-content');
            if (exEl) exEl.textContent = targetNode.example;
            updateRouteBar(targetNode);
        }

        function clearSidebar() {
            const sidebarContent = document.getElementById('sidebar-content');
            if (clickedNode) {
                updateSidebar(clickedNode, false);
            } else {
                sidebarContent.innerHTML = '<div class="empty-state">Hover over a node to see its hierarchy</div>';
                updateRouteBar(null);
            }
        }

        // ===== CLEAR SELECTION =====
        function clearSelection() {
            clickedNode = null;
            focusedNode = null;
            currentSidebarNode = null;
            // Clear all persistent orange highlights
            function clearAllPersistent(node) {
                node._persistent = false;
                if (node.children) node.children.forEach(clearAllPersistent);
            }
            forestRoots.forEach(clearAllPersistent);
            clearHighlight();
            nodeId = 0;
            updateRootPositions();
            getActiveRoots().forEach((root, idx) => assignIds(root, 0, idx));
            render();
            document.getElementById('sidebar-content').innerHTML = '<div class="empty-state">Hover over a node to see its hierarchy</div>';
            updateRouteBar(null);
        }

        // ===== RENDER =====
        function render() {
            if (!g) {
                initializeTreeCanvas();
            }

            g.selectAll("*").remove();

            const allNodes = [];
            const allLinks = [];

            const deepestLevel = getDeepestVisibleLevel();
            const layout = getLayoutMetrics();
            visibleBounds = null;

            getActiveRoots().forEach((root, idx) => {
                const cx = rootPositions[idx].x;
                const cy = rootPositions[idx].y;

                root._x = cx;
                root._y = cy;
                root._r = getNodeSize(root, deepestLevel);
                allNodes.push(root);

                renderChildren(root, cx, cy, 0, 0, Math.PI * 2);
            });

            function countVisibleLeaves(node) {
                const visible = node._visibleChildren || [];
                if (visible.length === 0) return 1;
                return visible.reduce((sum, child) => sum + countVisibleLeaves(child), 0);
            }

            function renderChildren(parent, cx, cy, depth, startAngle, endAngle) {
                const visible = parent._visibleChildren || [];
                if (visible.length === 0) return;

                const childWeights = visible.map(countVisibleLeaves);
                const totalWeight = childWeights.reduce((sum, value) => sum + value, 0);
                const siblingGap = Math.min(layout.siblingGap, ((endAngle - startAngle) / Math.max(visible.length, 1)) * 0.35);
                const usableAngle = Math.max(0.01, (endAngle - startAngle) - siblingGap * Math.max(0, visible.length - 1));
                let cursor = startAngle;

                visible.forEach((child, idx) => {
                    const angleSpan = usableAngle * (childWeights[idx] / totalWeight);
                    const childStart = cursor;
                    const childEnd = cursor + angleSpan;
                    const angle = childStart + angleSpan / 2;
                    const ringDistance = layout.ringSpacing * (depth + 1) + Math.max(0, visible.length - 4) * 12;
                    child._x = cx + ringDistance * Math.cos(angle);
                    child._y = cy + ringDistance * Math.sin(angle);

                    child._r = getNodeSize(child, deepestLevel);

                    allNodes.push(child);
                    allLinks.push({ source: parent, target: child });

                    renderChildren(child, cx, cy, depth + 1, childStart, childEnd);
                    cursor = childEnd + siblingGap;
                });
            }

            allNodes.forEach(node => {
                const padding = node._r + 28;
                if (!visibleBounds) {
                    visibleBounds = {
                        minX: node._x - padding,
                        maxX: node._x + padding,
                        minY: node._y - padding,
                        maxY: node._y + padding
                    };
                    return;
                }

                visibleBounds.minX = Math.min(visibleBounds.minX, node._x - padding);
                visibleBounds.maxX = Math.max(visibleBounds.maxX, node._x + padding);
                visibleBounds.minY = Math.min(visibleBounds.minY, node._y - padding);
                visibleBounds.maxY = Math.max(visibleBounds.maxY, node._y + padding);
            });

            // Draw links
            g.selectAll("path.link")
                .data(allLinks)
                .enter().append("path")
                .attr("class", d => {
                    let cls = 'link';
                    if (d.source._persistent && d.target._persistent) cls += ' persistent';
                    return cls;
                })
                .attr("d", d => {
                    return `M ${d.source._x} ${d.source._y}
                            C ${(d.source._x + d.target._x) / 2} ${d.source._y},
                              ${(d.source._x + d.target._x) / 2} ${d.target._y},
                              ${d.target._x} ${d.target._y}`;
                });

            // Draw nodes
            const nodeSel = g.selectAll("g.node")
                .data(allNodes)
                .enter().append("g")
                .attr("class", d => {
                    let cls = 'node';
                    if (d._depth === 0) cls += ' root';
                    if (d._persistent) cls += ' persistent';
                    return cls;
                })
                .attr("transform", d => `translate(${d._x},${d._y})`)
                .on('click', click)
                .on('mouseenter', (e, d) => {
                    highlightBranch(d);
                    updateSidebar(d, false);
                })
                .on('mouseleave', () => {
                    clearHighlight();
                    // Only clear sidebar back to clicked node or empty state
                    if (clickedNode) {
                        updateSidebar(clickedNode, false);
                    } else {
                        clearSidebar();
                    }
                });

            // Circle
            nodeSel.append('circle')
                .attr('r', d => d._r);

            // Text inside circle - dynamically sized to FIT inside the node
            nodeSel.each(function(d) {
                const el = d3.select(this);
                const r = d._r;
                const padding = 6;
                const maxTextWidth = (r - padding) * 2;

                let fontSize = Math.max(6, Math.min(10, r * 0.38));
                const charWidth = fontSize * 0.55;
                const textLength = d.name.length;
                const estimatedWidth = textLength * charWidth;

                if (estimatedWidth > maxTextWidth) {
                    fontSize = Math.max(6, fontSize * (maxTextWidth / estimatedWidth) * 0.9);
                }

                const words = d.name.split(/\s+/);

                function fits(str) {
                    return (str.length * fontSize * 0.55) <= maxTextWidth;
                }

                if (words.length === 1 || (d.name.length <= 10 && fits(d.name))) {
                    el.append('text')
                        .attr('dy', '0.1em')
                        .style('font-size', fontSize + 'px')
                        .text(d.name);
                } else if (words.length === 2) {
                    const lineHeight = fontSize * 1.1;
                    const totalHeight = lineHeight * 2;
                    const startY = -(totalHeight / 2) + (lineHeight / 2);

                    el.append('text')
                        .attr('y', startY)
                        .style('font-size', fontSize + 'px')
                        .text(words[0]);
                    el.append('text')
                        .attr('y', startY + lineHeight)
                        .style('font-size', fontSize + 'px')
                        .text(words[1]);
                } else {
                    const mid = Math.ceil(words.length / 2);
                    const line1 = words.slice(0, mid).join(' ');
                    const line2 = words.slice(mid).join(' ');

                    const longestLine = Math.max(line1.length, line2.length);
                    if (longestLine * fontSize * 0.55 > maxTextWidth) {
                        fontSize = Math.max(6, fontSize * (maxTextWidth / (longestLine * fontSize * 0.55)) * 0.9);
                    }

                    const lineHeight = fontSize * 1.1;
                    const totalHeight = lineHeight * 2;
                    const startY = -(totalHeight / 2) + (lineHeight / 2);

                    el.append('text')
                        .attr('y', startY)
                        .style('font-size', fontSize + 'px')
                        .text(line1);
                    el.append('text')
                        .attr('y', startY + lineHeight)
                        .style('font-size', fontSize + 'px')
                        .text(line2);
                }
            });
        }

        function click(event, d) {
            // Toggle collapse/expand for all nodes with children
            d._collapsed = !d._collapsed;
            d._visibleChildren = d._collapsed ? [] : d.children;

            // Set persistent orange highlight on this node and its path
            // First clear all persistent highlights
            function clearAllPersistent(node) {
                node._persistent = false;
                if (node.children) node.children.forEach(clearAllPersistent);
            }
            forestRoots.forEach(clearAllPersistent);

            // Set persistent on clicked node and its ancestors
            let curr = d;
            while (curr) {
                curr._persistent = true;
                curr = curr._parent;
            }

            render();
            setTimeout(() => {
                if (focusedNode === d) {
                    centerOnRoots();
                } else {
                    centerOnNode(d, 500);
                }
                updateSidebar(d, true);
            }, 50);
        }

        // ===== BRANCH HIGHLIGHTING =====
        function highlightBranch(node) {
            const pathIds = new Set();

            function collectPath(n) {
                pathIds.add(n._id);
                if (n._parent) {
                    collectPath(n._parent);
                }
            }

            collectPath(node);

            g.selectAll('g.node')
                .classed('highlighted', d => pathIds.has(d._id));

            g.selectAll('path.link')
                .classed('highlighted', d => {
                    return pathIds.has(d.source._id) && pathIds.has(d.target._id);
                });
        }

        function clearHighlight() {
            g.selectAll('g.node').classed('highlighted', false);
            g.selectAll('path.link').classed('highlighted', false);
        }

        // ===== INTERACTIVE PRACTICE =====
        async function switchToPractice() {
            currentView = 'practice';
            document.body.classList.remove('quiz-mode');
            document.body.classList.add('practice-mode');
            document.querySelector('.file-name').textContent = 'interactive practice';
            updateRouteBar(null);
            setViewButtons();

            if (!practiceLoaded) {
                try {
                    const data = await loadPracticeData();
                    practiceExercises = buildPracticeExercises(data);
                    activePracticeExercises = [...practiceExercises];
                    practiceLoaded = true;
                } catch (error) {
                    showNotice(`Could not load practice data. ${error.message}`, true);
                    return;
                }
            }

            if (practiceExercises.length === 0) {
                showNotice('No practice exercises found.', true);
                return;
            }

            renderPracticeSidebar();
            renderPracticeExercise();
            showNotice(`Loaded ${practiceExercises.length} practice exercise${practiceExercises.length === 1 ? '' : 's'}.`);
        }

        async function loadPracticeData() {
            const manifest = await loadPracticeManifest();
            const sources = getPracticeManifestSources(manifest);

            const results = await Promise.allSettled(Object.entries(sources).map(async ([key, endpoint]) => {
                const response = await fetch(endpoint, { cache: 'no-store' });
                if (!response.ok) throw new Error(`${endpoint} returned ${response.status}`);
                return [key, rowsToObjects(parseCSVRobust(await response.text()))];
            }));

            const data = {};
            const failed = [];
            results.forEach(result => {
                if (result.status === 'fulfilled') {
                    const [key, rows] = result.value;
                    data[key] = rows;
                } else {
                    failed.push(result.reason.message);
                }
            });

            const required = ['classify', 'balanceSheet', 'statements', 'retainedEarnings'];
            const missingRequired = required.filter(key => !data[key]);
            if (missingRequired.length > 0) {
                throw new Error(`Missing required practice data: ${missingRequired.join(', ')}`);
            }

            if (failed.length > 0) {
                showNotice(`Some optional practice data did not load: ${failed.join('; ')}`, true);
            }

            return data;
        }

        async function loadPracticeManifest() {
            const response = await fetch('/api/practice-manifest', { cache: 'no-store' });
            if (!response.ok) {
                throw new Error(`/api/practice-manifest returned ${response.status}`);
            }
            return response.json();
        }

        function getPracticeManifestSources(manifest) {
            const sources = {};
            (manifest.modules || []).forEach(module => {
                (module.files || []).forEach(file => {
                    if (!file.key || !file.path) return;
                    sources[file.key] = `/api/practice-data/${encodePracticeDataPath(file.path)}`;
                });
            });
            return sources;
        }

        function encodePracticeDataPath(path) {
            return String(path)
                .split('/')
                .map(part => encodeURIComponent(part))
                .join('/');
        }

        function rowsToObjects(rows) {
            if (rows.length < 2) return [];
            const headers = rows[0].map(header => header.trim());
            return rows.slice(1).map(row => {
                const item = {};
                headers.forEach((header, idx) => {
                    item[header] = (row[idx] || '').trim();
                });
                return item;
            }).filter(item => Object.values(item).some(Boolean));
        }

        function buildPracticeExercises(data) {
            const exercises = [];
            const classifyRows = data.classify || [];
            const batchSize = 8;

            for (let i = 0; i < classifyRows.length; i += batchSize) {
                const rows = classifyRows.slice(i, i + batchSize);
                exercises.push({
                    type: 'classify_type',
                    topic: 'Classify: Account Type',
                    title: 'What type of account is each of the following?',
                    subtitle: "(Asset, Liability, Owners' Equity, Revenue, Expense, Gain/Loss)",
                    rows
                });
                exercises.push({
                    type: 'classify_stmt',
                    topic: 'Classify: Statement',
                    title: 'Which financial statement does each item belong on?',
                    subtitle: '(Balance Sheet or Income Statement)',
                    rows: rows.map(row => ({ ...row }))
                });
            }

            groupPracticeRows(data.balanceSheet || [], 'exercise_id').forEach(group => {
                exercises.push({
                    type: 'drag_bs',
                    topic: 'Build: Balance Sheet',
                    title: 'Build the balance sheet by dragging each item into the right section.',
                    subtitle: 'Use liquidity for assets and maturity for liabilities.',
                    rows: group.rows
                });
            });

            groupPracticeRows(data.statements || [], 'exercise_id').forEach(group => {
                const exerciseType = group.rows[0]?.exercise_type;
                const isCashFlow = exerciseType === 'cashflow';
                exercises.push({
                    type: isCashFlow ? 'fill_cf' : 'fill_is',
                    topic: isCashFlow ? 'Build: Cash Flow' : 'Build: Income Statement',
                    title: isCashFlow ? 'Complete the statement of cash flows.' : 'Complete the income statement.',
                    subtitle: 'Fill in the missing subtotal and total amounts.',
                    company: group.id === 'is2' ? 'Easy Corp.' : 'Practice Corp.',
                    rows: group.rows.sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
                });
            });

            groupPracticeRows(data.retainedEarnings || [], 'exercise_id').forEach(group => {
                exercises.push({
                    type: 'fill_re',
                    topic: 'Retained Earnings',
                    title: group.id.startsWith('se') ? "Complete the stockholders' equity roll-forward." : 'Complete retained earnings.',
                    subtitle: 'Use beginning balance, additions, and reductions to reach ending balance.',
                    scenario: group.id.startsWith('se')
                        ? 'Complete the year-end equity balances using the roll-forward format.'
                        : 'Calculate ending retained earnings from beginning retained earnings, net income, and dividends.',
                    rows: group.rows
                });
            });

            buildWeekTwoPracticeExercises(data, exercises);
            buildAccrualPracticeExercises(data, exercises);
            buildWeekThreePracticeExercises(data, exercises);

            return exercises;
        }

        function buildWeekThreePracticeExercises(data, exercises) {
            if ((data.week3RatioTable || []).length > 0) {
                exercises.push({
                    type: 'ratio_table',
                    topic: 'Week 3: Ratio Analysis',
                    title: 'Walmart vs. Costco: compute key ratios.',
                    subtitle: 'Fill in each ratio for both companies. Use the financial figures shown.',
                    rows: data.week3RatioTable,
                    walmartFigures: data.week3WalmartFigures || [],
                    costcoFigures: data.week3CostcoFigures || []
                });
            }

            groupPracticeRows(data.week3Dupont || [], 'exercise_id').forEach(group => {
                const company = group.rows[0]?.company || 'Company';
                exercises.push({
                    type: 'fill_calc',
                    topic: 'Week 3: Ratio Analysis',
                    title: `DuPont Analysis: ${company}`,
                    subtitle: 'ROA = PM x AT | ROE = PM x AT x Equity Multiplier',
                    scenario: `${company}: complete the DuPont relationship using the provided ratio components.`,
                    parts: group.rows.map(row => buildCalcPart(row.part_label, row.answer, row.is_given, row.hint))
                });
            });

            if ((data.week3CommonSize || []).length > 0) {
                exercises.push({
                    type: 'common_size',
                    topic: 'Week 3: Common-Size & Trend',
                    title: 'Common-size income statement: Micro Corp.',
                    subtitle: 'Express each line item as a percentage of revenue for each year.',
                    rows: data.week3CommonSize
                });
            }

            if ((data.week3Trend || []).length > 0) {
                exercises.push({
                    type: 'trend_stmt',
                    topic: 'Week 3: Common-Size & Trend',
                    title: 'Trend statement: Micro Corp.',
                    subtitle: 'Express each item as a percentage of the same item in base year 2016.',
                    rows: data.week3Trend
                });
            }

            if ((data.week3RatioInterpretation || []).length > 0) {
                exercises.push({
                    type: 'scenario_mcq',
                    topic: 'Week 3: Ratio Analysis',
                    title: 'Ratio Interpretation: Walmart vs. Costco',
                    subtitle: 'Use the calculated ratios to answer interpretation questions.',
                    rows: buildScenarioRows(data.week3RatioInterpretation)
                });
            }
        }

        function buildAccrualPracticeExercises(data, exercises) {
            if ((data.revenueScenarios || []).length > 0) {
                exercises.push({
                    type: 'scenario_mcq',
                    topic: 'Accrual: Revenue Recognition',
                    title: 'Revenue Recognition: Can you record revenue?',
                    subtitle: 'Decide when revenue can be recognized for each scenario.',
                    rows: buildScenarioRows(data.revenueScenarios)
                });
            }

            if ((data.matchingScenarios || []).length > 0) {
                exercises.push({
                    type: 'scenario_mcq',
                    topic: 'Accrual: Matching Principle',
                    title: 'Matching Principle: When is the expense recorded?',
                    subtitle: 'Identify the correct period for each expense scenario.',
                    rows: buildScenarioRows(data.matchingScenarios)
                });
            }

            if ((data.warrantyClassifier || []).length > 0) {
                exercises.push({
                    type: 'drag_warranty',
                    topic: 'Accrual: Matching Principle',
                    title: 'Classify each warranty.',
                    subtitle: 'Assurance warranties are matched to sale date; extended warranties are recognized over time.',
                    rows: data.warrantyClassifier.map(row => ({
                        item_label: row.item_label,
                        correct_type: row.correct_type,
                        hint: row.hint
                    }))
                });
            }

            const hasFinancialStatementReader = (data.fsReaderIncomeStatement || []).length > 0
                && (data.fsReaderBalanceSheet || []).length > 0
                && (data.fsReaderQuestions || []).length > 0;
            if (hasFinancialStatementReader) {
                exercises.push({
                    type: 'fs_reader',
                    topic: 'Financial Statement Analysis',
                    title: "Read Costco's financial statements.",
                    subtitle: 'Use the condensed income statement and balance sheet to answer each question.',
                    data: {
                        income: data.fsReaderIncomeStatement,
                        balance: data.fsReaderBalanceSheet,
                        questions: buildScenarioRows(data.fsReaderQuestions, 'question_text')
                    }
                });
            }

            groupPracticeRows(data.ratioCalculations || [], 'exercise_id').forEach(group => {
                const first = group.rows[0] || {};
                exercises.push({
                    type: 'fill_calc',
                    topic: 'Financial Statement Analysis',
                    title: first.title || 'Ratio Calculation',
                    subtitle: first.formula || 'Calculate the requested ratio.',
                    scenario: first.scenario || '',
                    parts: group.rows.map(row => buildCalcPart(row.part_label, row.answer, row.is_given, row.hint))
                });
            });
        }

        function buildScenarioRows(rows, questionKey = 'question') {
            const letters = ['A', 'B', 'C', 'D'];
            return rows.map(row => ({
                context: row.context || '',
                question: row[questionKey] || row.question || '',
                options: [row.option_a, row.option_b, row.option_c, row.option_d].filter(Boolean),
                answer: letters.indexOf(String(row.correct_option || '').trim().toUpperCase()),
                explanation: row.explanation || ''
            })).filter(row => row.question && row.options.length > 0 && row.answer >= 0);
        }

        function buildWeekTwoPracticeExercises(data, exercises) {
            const revenueSteps = (data.revenueSteps || [])
                .map(row => ({
                    order: Number(row.step_number),
                    label: row.step_title,
                    detail: row.step_detail
                }))
                .filter(row => row.order && row.label);

            if (revenueSteps.length > 0) {
                exercises.push({
                    type: 'drag_steps',
                    topic: 'Revenue Recognition',
                    title: 'Put the 5 revenue recognition steps in the correct order.',
                    subtitle: 'Drag each step into its numbered slot.',
                    rows: revenueSteps
                });
            }

            groupPracticeRows(data.revenueCalculations || [], 'exercise_id').forEach(group => {
                const company = group.rows[0]?.company || 'Revenue Practice';
                exercises.push({
                    type: 'fill_calc',
                    topic: 'Revenue Recognition',
                    title: `Revenue Recognition: ${company}`,
                    subtitle: 'Fill in the missing recognized revenue amounts.',
                    scenario: buildRevenueScenario(group.id, company),
                    parts: group.rows.map(row => buildCalcPart(row.part_label, row.answer, row.is_given, row.hint))
                });
            });

            if ((data.cashClassification || []).length > 0) {
                exercises.push({
                    type: 'drag_cash',
                    topic: 'Cash Classification',
                    title: 'Classify each item as cash, cash equivalent, restricted cash, or other investment.',
                    subtitle: 'Cash equivalents mature in 3 months or less when purchased.',
                    rows: data.cashClassification.map(row => ({
                        item_label: row.item_label,
                        correct_category: row.correct_category,
                        hint: row.hint
                    }))
                });
            }

            groupPracticeRows(data.arBadDebt || [], 'exercise_id').forEach(group => {
                const company = group.rows[0]?.company || 'A/R Practice';
                exercises.push({
                    type: 'fill_calc',
                    topic: 'A/R & Bad Debt',
                    title: `A/R & Bad Debt: ${company}`,
                    subtitle: 'Trace gross A/R, allowance, and bad debt expense.',
                    scenario: buildArScenario(group.id, company),
                    parts: group.rows.map(row => buildCalcPart(row.part_label, row.answer, row.is_given, row.hint))
                });
            });

            groupPracticeRows(data.inventoryLayers || [], 'exercise_id').forEach(group => {
                const answers = (data.inventoryAnswers || []).filter(row => row.exercise_id === group.id);
                exercises.push({
                    type: 'fill_inventory',
                    topic: 'Inventory',
                    title: 'Inventory Costing: FIFO vs. LIFO',
                    subtitle: 'Calculate COGS and ending inventory under each method.',
                    scenario: 'Use the available inventory layers below. Assume 8,000 units were sold.',
                    layers: group.rows,
                    rows: answers
                });
            });

            groupPracticeRows(data.ppeCapitalization || [], 'exercise_id').forEach(group => {
                exercises.push({
                    type: 'drag_ppe',
                    topic: 'PPE & Depreciation',
                    title: 'Classify each expenditure as land, building, or expense.',
                    subtitle: 'Only costs needed to acquire and ready the asset for use are capitalized.',
                    scenario: 'A company purchased land and constructed a building. Classify each expenditure.',
                    rows: group.rows
                });
            });

            groupPracticeRows(data.depreciation || [], 'exercise_id').forEach(group => {
                const method = group.rows[0]?.method || 'Depreciation';
                exercises.push({
                    type: 'fill_calc',
                    topic: 'PPE & Depreciation',
                    title: `Depreciation: ${method}`,
                    subtitle: 'Fill in depreciation amounts and book values.',
                    scenario: buildDepreciationScenario(group.id, method),
                    parts: group.rows.map(row => buildCalcPart(row.part_label, row.answer, row.is_given, row.hint))
                });
            });

            groupPracticeRows(data.bondAmortization || [], 'exercise_id').forEach(group => {
                exercises.push({
                    type: 'fill_bonds',
                    topic: 'Bonds & Debt',
                    title: group.id === 'bond2'
                        ? 'Bond Amortization: Discount Bond'
                        : 'Bond Amortization: Par Bond',
                    subtitle: 'Complete the amortization table using effective interest.',
                    scenario: group.id === 'bond2'
                        ? 'Zero-coupon bond issued at a discount. Market rate is 10% annually, compounded semiannually.'
                        : 'Par bond where stated rate equals market rate. Payments are semiannual.',
                    rows: group.rows
                });
            });
        }

        function buildCalcPart(label, answer, isGiven, hint) {
            return {
                label,
                answer: Number(answer),
                given: String(isGiven || '').toLowerCase() === 'true',
                hint
            };
        }

        function buildRevenueScenario(id, company) {
            if (id === 'rev1') {
                return `${company} sold 1,000 bundled phones at $800 each. Hardware is 60% and recognized at sale; software is 40% and recognized over 2 years. The sale occurred October 1, 2024.`;
            }
            if (id === 'rev2') {
                return `${company} sold 500 annual subscriptions for $120 each starting July 1, 2024. Recognize revenue for the months of service provided in 2024.`;
            }
            return `Complete the revenue recognition calculations for ${company}.`;
        }

        function buildArScenario(id, company) {
            if (id === 'ar1') {
                return `${company}: beginning net A/R is $432 with a $30 allowance. Credit sales are $1,750, collections are $1,830, write-offs are $35, and required allowance is 10% of ending gross A/R.`;
            }
            return `${company}: use the given A/R activity to compute ending gross A/R, required allowance, and bad debt expense.`;
        }

        function buildDepreciationScenario(id, method) {
            if (id === 'dep1') {
                return 'Asset cost is $50,000, salvage value is $5,000, and useful life is 5 years.';
            }
            if (id === 'dep2') {
                return 'Asset cost is $40,000, useful life is 4 years, and the method is double-declining-balance.';
            }
            return `Complete the ${method} depreciation calculations.`;
        }

        function groupPracticeRows(rows, key) {
            const map = new Map();
            rows.forEach(row => {
                const id = row[key] || 'practice';
                if (!map.has(id)) map.set(id, []);
                map.get(id).push(row);
            });
            return Array.from(map, ([id, groupRows]) => ({ id, rows: groupRows }));
        }

        function renderPracticeSidebar() {
            const sidebarContent = document.getElementById('sidebar-content');
            const counts = practiceExercises.reduce((acc, exercise) => {
                acc[exercise.topic] = (acc[exercise.topic] || 0) + 1;
                return acc;
            }, {});
            const topics = ['All', ...Object.keys(counts)];

            sidebarContent.innerHTML = `
                <div class="practice-nav">
                    <div class="practice-tools">
                        <button id="practice-reset" class="practice-tool-button" type="button">${practiceFinished ? 'Restart' : 'Reset'}</button>
                        <button id="practice-hint" class="practice-tool-button" type="button">Hint</button>
                        <button id="practice-check" class="practice-tool-button" type="button" ${practiceFinished ? 'disabled' : ''}>Check</button>
                        <button id="practice-next-side" class="practice-tool-button" type="button" ${practiceFinished ? 'disabled' : ''}>Next &rarr;</button>
                    </div>
                    <div class="practice-topic-label">Exercise Type</div>
                    ${topics.map(topic => {
                        const count = topic === 'All' ? practiceExercises.length : counts[topic];
                        return `
                            <button class="practice-topic ${activePracticeTopic === topic ? 'active' : ''}" type="button" data-topic="${escapeHTML(topic)}">
                                <span>${escapeHTML(topic)}</span>
                                <span>${count}</span>
                            </button>
                        `;
                    }).join('')}
                </div>
            `;

            document.getElementById('practice-reset').addEventListener('click', practiceFinished ? restartPractice : resetPracticeExercise);
            document.getElementById('practice-hint').addEventListener('click', showPracticeHint);
            document.getElementById('practice-check').addEventListener('click', checkPracticeAnswers);
            document.getElementById('practice-next-side').addEventListener('click', nextPracticeExercise);
            sidebarContent.querySelectorAll('.practice-topic').forEach(button => {
                button.addEventListener('click', event => {
                    activePracticeTopic = event.currentTarget.dataset.topic;
                    activePracticeExercises = activePracticeTopic === 'All'
                        ? [...practiceExercises]
                        : practiceExercises.filter(exercise => exercise.topic === activePracticeTopic);
                    practiceIndex = 0;
                    practiceFinished = false;
                    renderPracticeSidebar();
                    renderPracticeExercise();
                });
            });
        }

        function renderPracticeExercise() {
            const exercise = activePracticeExercises[practiceIndex];
            if (!exercise) return;

            const buttonLabel = practiceIndex >= activePracticeExercises.length - 1 ? 'Finish' : 'Next';
            const checked = !!exercise._checked;
            const locked = practiceFinished || checked;

            container.innerHTML = `
                <div class="practice-shell">
                    <div class="practice-progress-track">
                        <div class="practice-progress-fill" style="width:${((practiceIndex + 1) / activePracticeExercises.length) * 100}%"></div>
                    </div>
                    <div class="practice-header">
                        <span class="practice-tag">${escapeHTML(exercise.topic)}</span>
                        <span class="practice-position">${practiceIndex + 1} of ${activePracticeExercises.length}</span>
                    </div>
                    <div class="practice-content" id="practice-content">
                        <h1 class="practice-title">${escapeHTML(exercise.title)}</h1>
                        <div class="practice-subtitle">${escapeHTML(exercise.subtitle || '')}</div>
                        <div class="practice-feedback" id="practice-feedback"></div>
                        <div id="practice-body"></div>
                    </div>
                    <div class="practice-footer">
                        <div class="practice-footer-group">
                            <button id="practice-prev" class="practice-button" type="button" ${practiceIndex === 0 ? 'disabled' : ''}>Previous</button>
                            <button id="practice-footer-hint" class="practice-button" type="button">Hint</button>
                        </div>
                        <div class="practice-score">Score: <strong id="practice-score-correct">${practiceScoreCorrect}</strong> / <span id="practice-score-total">${practiceScoreTotal}</span></div>
                        <div class="practice-footer-group">
                            <button id="practice-footer-check" class="practice-button" type="button" ${locked ? 'disabled' : ''}>Check</button>
                            <button id="practice-next" class="practice-button primary" type="button" ${practiceFinished ? 'disabled' : ''}>${buttonLabel}</button>
                            ${practiceFinished ? '<button id="practice-restart-inline" class="practice-button primary" type="button">Restart</button>' : ''}
                        </div>
                    </div>
                </div>
            `;

            const body = document.getElementById('practice-body');
            if (exercise.type === 'classify_type') renderPracticeClassify(body, exercise, 'account_type', ['Asset', 'Liability', 'Owners Equity', 'Revenue', 'Expense', 'Gain/Loss']);
            if (exercise.type === 'classify_stmt') renderPracticeClassify(body, exercise, 'statement', ['Balance Sheet', 'Income Statement']);
            if (exercise.type === 'drag_bs') renderPracticeDrag(body, exercise, [
                { id: 'assets', label: 'Assets', sub: 'Ordered by liquidity' },
                { id: 'liabilities', label: 'Liabilities', sub: 'Ordered by maturity' },
                { id: 'ownersequity', label: "Owners' Equity", sub: 'No required order' }
            ], row => row.correct_section);
            if (exercise.type === 'drag_cf') renderPracticeDrag(body, exercise, [
                { id: 'operating', label: 'Operating Activities', sub: 'Day-to-day business operations' },
                { id: 'investing', label: 'Investing Activities', sub: 'Long-term assets and loans' },
                { id: 'financing', label: 'Financing Activities', sub: 'Debt and equity capital' }
            ], row => row.section);
            if (exercise.type === 'fill_is') renderPracticeStatement(body, exercise, false);
            if (exercise.type === 'fill_cf') renderPracticeStatement(body, exercise, true);
            if (exercise.type === 'fill_re') renderPracticeRetainedEarnings(body, exercise);
            if (exercise.type === 'drag_steps') renderPracticeSteps(body, exercise);
            if (exercise.type === 'fill_calc') renderPracticeCalculation(body, exercise);
            if (exercise.type === 'drag_cash') renderPracticeDrag(body, exercise, [
                { id: 'cash', label: 'Cash', sub: 'Currency, checking, and savings balances' },
                { id: 'cashequivalent', label: 'Cash Equivalent', sub: 'Highly liquid investments with maturity of 3 months or less' },
                { id: 'restrictedcash', label: 'Restricted Cash', sub: 'Cash legally unavailable for current operations' },
                { id: 'otherinvestment', label: 'Other Investment', sub: 'Longer maturity investments and equity holdings' }
            ], row => row.correct_category);
            if (exercise.type === 'drag_ppe') renderPracticeScenarioDrag(body, exercise, [
                { id: 'land', label: 'Land', sub: 'Acquire and prepare the land site' },
                { id: 'building', label: 'Building', sub: 'Construct and ready the building' },
                { id: 'expense', label: 'Expense', sub: 'Period costs, repairs, and maintenance' }
            ], row => row.correct_category);
            if (exercise.type === 'fill_inventory') renderPracticeInventory(body, exercise);
            if (exercise.type === 'fill_bonds') renderPracticeBonds(body, exercise);
            if (exercise.type === 'scenario_mcq') renderPracticeScenarioMcq(body, exercise);
            if (exercise.type === 'drag_warranty') renderPracticeDrag(body, exercise, [
                { id: 'assurancewarranty', label: 'Assurance Warranty', sub: 'Included in sale price and matched to sale date' },
                { id: 'extendedwarranty', label: 'Extended Warranty', sub: 'Separately purchased and recognized over the warranty period' }
            ], row => row.correct_type);
            if (exercise.type === 'fs_reader') renderPracticeFinancialStatementReader(body, exercise);
            if (exercise.type === 'ratio_table') renderPracticeRatioTable(body, exercise);
            if (exercise.type === 'common_size') renderPracticeCommonSize(body, exercise);
            if (exercise.type === 'trend_stmt') renderPracticeTrendStatement(body, exercise);
            restorePracticeResponses(exercise);
            if (checked) {
                markPracticeAnswers(exercise);
                showCheckedPracticeResult(exercise);
            }

            document.getElementById('practice-prev').addEventListener('click', previousPracticeExercise);
            document.getElementById('practice-footer-hint').addEventListener('click', showPracticeHint);
            document.getElementById('practice-footer-check').addEventListener('click', checkPracticeAnswers);
            document.getElementById('practice-next').addEventListener('click', nextPracticeExercise);
            const restartButton = document.getElementById('practice-restart-inline');
            if (restartButton) restartButton.addEventListener('click', restartPractice);
        }

        function renderPracticeClassify(body, exercise, answerKey, options) {
            const grid = document.createElement('div');
            grid.className = 'practice-grid';
            exercise.rows.forEach((row, idx) => {
                const card = document.createElement('div');
                card.className = 'practice-card';
                card.innerHTML = `
                    <div class="practice-card-label">${escapeHTML(row.label)}</div>
                    <div class="practice-options">
                        ${options.map(option => `<button class="practice-option" type="button" data-row="${idx}" data-value="${escapeHTML(option)}">${escapeHTML(option)}</button>`).join('')}
                    </div>
                `;
                grid.appendChild(card);
            });
            body.appendChild(grid);

            grid.querySelectorAll('.practice-option').forEach(button => {
                button.addEventListener('click', event => {
                    const row = exercise.rows[Number(event.currentTarget.dataset.row)];
                    row._selected = event.currentTarget.dataset.value;
                    event.currentTarget.closest('.practice-options').querySelectorAll('.practice-option').forEach(item => item.classList.remove('selected'));
                    event.currentTarget.classList.add('selected');
                });
            });
        }

        function renderPracticeDrag(body, exercise, zones, answerGetter) {
            const poolLabel = document.createElement('div');
            poolLabel.className = 'practice-pool-label';
            poolLabel.textContent = 'Items - drag to the correct section';
            body.appendChild(poolLabel);

            const pool = document.createElement('div');
            pool.className = 'practice-pool';
            attachPracticeDrop(pool);
            body.appendChild(pool);

            exercise.rows.forEach((row, idx) => {
                const chip = document.createElement('div');
                chip.className = 'practice-chip';
                chip.id = `practice-chip-${idx}`;
                chip.draggable = true;
                chip.dataset.itemIndex = String(idx);
                const correctLabel = answerGetter(row);
                chip.dataset.correct = normalizePracticeKey(correctLabel);
                chip.dataset.correctLabel = correctLabel;
                chip.textContent = row.item_label ? `${row.item_label}${row.amount ? ` $${row.amount}` : ''}` : row.label;
                chip.addEventListener('dragstart', () => {
                    practiceDraggedEl = chip;
                    chip.classList.add('dragging');
                });
                chip.addEventListener('dragend', () => chip.classList.remove('dragging'));
                pool.appendChild(chip);
            });

            const grid = document.createElement('div');
            grid.className = 'practice-drop-grid';
            zones.forEach(zoneConfig => {
                const zone = document.createElement('div');
                zone.className = 'practice-drop-zone';
                zone.dataset.zone = zoneConfig.id;
                zone.innerHTML = `
                    <div class="practice-drop-label">${escapeHTML(zoneConfig.label)}</div>
                    <div class="practice-drop-sub">${escapeHTML(zoneConfig.sub)}</div>
                `;
                attachPracticeDrop(zone);
                grid.appendChild(zone);
            });
            body.appendChild(grid);
        }

        function attachPracticeDrop(zone) {
            zone.addEventListener('dragover', event => {
                event.preventDefault();
                zone.classList.add('drag-over');
            });
            zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
            zone.addEventListener('drop', event => {
                event.preventDefault();
                zone.classList.remove('drag-over');
                if (practiceDraggedEl) {
                    zone.appendChild(practiceDraggedEl);
                    practiceDraggedEl = null;
                }
            });
        }

        function renderPracticeStatement(body, exercise, isCashFlow) {
            const title = document.createElement('div');
            title.style.cssText = 'text-align:center;margin-bottom:16px;';
            title.innerHTML = `<strong>${escapeHTML(exercise.company || 'Practice Corp.')}</strong><br><span style="font-size:13px;color:#526174">${isCashFlow ? 'Statement of Cash Flows (Indirect Method)' : 'Income Statement'}<br>For the year ended December 31, 2024</span>`;
            body.appendChild(title);

            const table = document.createElement('table');
            table.className = 'practice-table';
            const subtotals = ['Gross Profit', 'Operating Income', 'Income Before Taxes', 'Net Income', 'Cash from Operations', 'Cash from Investing', 'Cash from Financing', 'Change in Cash'];
            const sectionHeaders = {
                'Net Income': 'Operating Section:',
                'Cash paid for PPE': 'Investing Section:',
                'Issued Stock': 'Financing Section:',
                'Change in Cash': 'Summary:'
            };

            exercise.rows.forEach(row => {
                if (isCashFlow && sectionHeaders[row.label]) {
                    const header = document.createElement('tr');
                    header.className = 'section-header';
                    header.innerHTML = `<td colspan="2">${escapeHTML(sectionHeaders[row.label])}</td>`;
                    table.appendChild(header);
                }

                const tr = document.createElement('tr');
                const isSubtotal = subtotals.includes(row.label);
                tr.className = isSubtotal ? 'subtotal' : 'indented';
                const value = Number(row.value);
                const displayValue = value < 0 ? `(${Math.abs(value)})` : String(value);
                if (row.is_blank === 'true') {
                    tr.innerHTML = `
                        <td class="row-label">${isSubtotal ? `<strong>${escapeHTML(row.label)}</strong>` : escapeHTML(row.label)}</td>
                        <td class="row-value"><input class="practice-input" type="number" placeholder="?" data-answer="${escapeHTML(row.value)}" data-hint="${escapeHTML(row.hint)}"></td>
                    `;
                } else {
                    tr.innerHTML = `
                        <td class="row-label">${isSubtotal ? `<strong>${escapeHTML(row.label)}</strong>` : escapeHTML(row.label)}</td>
                        <td class="row-value">${displayValue}</td>
                    `;
                }
                table.appendChild(tr);
            });
            body.appendChild(table);
        }

        function renderPracticeRetainedEarnings(body, exercise) {
            const card = document.createElement('div');
            card.className = 'practice-re-card';
            card.innerHTML = `<div class="practice-scenario">${escapeHTML(exercise.scenario)}</div>`;

            exercise.rows.forEach(row => {
                const item = document.createElement('div');
                item.className = 'practice-re-row';
                const sign = row.label.startsWith('Minus') ? '- ' : row.label.startsWith('Plus') ? '+ ' : '';
                const label = row.label.replace(/^(Plus |Minus )/, '');
                if (row.is_blank === 'true') {
                    item.innerHTML = `<span>${escapeHTML(sign + label)}</span><input class="practice-input" type="number" placeholder="?" data-answer="${escapeHTML(row.value)}" data-hint="${escapeHTML(row.hint)}">`;
                } else {
                    item.innerHTML = `<span>${escapeHTML(sign + label)}</span><span style="font-variant-numeric:tabular-nums;font-weight:700">$${escapeHTML(row.value)}</span>`;
                }
                card.appendChild(item);
            });

            body.appendChild(card);
        }

        function renderPracticeSteps(body, exercise) {
            const layout = document.createElement('div');
            layout.className = 'practice-step-grid';

            const poolCol = document.createElement('div');
            poolCol.innerHTML = '<div class="practice-pool-label">Steps - drag into order</div>';
            const pool = document.createElement('div');
            pool.className = 'practice-pool';
            attachPracticeDrop(pool);

            const shuffled = [...exercise.rows].sort((a, b) => {
                const seed = (a.order * 17) % 11;
                return seed - ((b.order * 17) % 11);
            });

            shuffled.forEach(step => {
                const item = document.createElement('div');
                item.className = 'practice-chip practice-step-chip';
                item.draggable = true;
                item.dataset.itemIndex = String(step.order);
                item.dataset.correct = String(step.order);
                item.dataset.correctLabel = `Step ${step.order}`;
                item.textContent = step.label;
                item.addEventListener('dragstart', () => {
                    practiceDraggedEl = item;
                    item.classList.add('dragging');
                });
                item.addEventListener('dragend', () => item.classList.remove('dragging'));
                pool.appendChild(item);
            });

            poolCol.appendChild(pool);

            const slotsCol = document.createElement('div');
            slotsCol.innerHTML = '<div class="practice-pool-label">Correct Order</div>';
            exercise.rows.forEach(step => {
                const slot = document.createElement('div');
                slot.className = 'practice-step-slot practice-drop-zone';
                slot.dataset.zone = String(step.order);
                slot.innerHTML = `<div class="practice-step-number">Step ${step.order}</div><div class="practice-drop-sub">${escapeHTML(step.detail)}</div>`;
                attachPracticeSingleDrop(slot, pool);
                slotsCol.appendChild(slot);
            });

            layout.appendChild(poolCol);
            layout.appendChild(slotsCol);
            body.appendChild(layout);
        }

        function attachPracticeSingleDrop(zone, pool) {
            zone.addEventListener('dragover', event => {
                event.preventDefault();
                zone.classList.add('drag-over');
            });
            zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
            zone.addEventListener('drop', event => {
                event.preventDefault();
                zone.classList.remove('drag-over');
                if (!practiceDraggedEl) return;
                const existing = zone.querySelector('.practice-chip');
                if (existing) pool.appendChild(existing);
                zone.appendChild(practiceDraggedEl);
                practiceDraggedEl = null;
            });
        }

        function renderPracticeCalculation(body, exercise) {
            if (exercise.scenario) {
                const scenario = document.createElement('div');
                scenario.className = 'practice-scenario';
                scenario.textContent = exercise.scenario;
                body.appendChild(scenario);
            }

            const card = document.createElement('div');
            card.className = 'practice-re-card practice-calc-card';
            exercise.parts.forEach((part, idx) => {
                const row = document.createElement('div');
                row.className = 'practice-re-row';
                const answer = Number(part.answer);
                if (part.given) {
                    row.innerHTML = `<span>${escapeHTML(part.label)}</span><span style="font-variant-numeric:tabular-nums;font-weight:700">${formatPracticeNumber(answer)}</span>`;
                } else {
                    row.innerHTML = `<span>${escapeHTML(part.label)}</span><input class="practice-input" type="number" step="0.01" placeholder="?" data-answer="${escapeHTML(answer)}" data-hint="${escapeHTML(part.hint || '')}">`;
                }
                card.appendChild(row);
            });
            body.appendChild(card);
        }

        function renderPracticeScenarioDrag(body, exercise, zones, answerGetter) {
            if (exercise.scenario) {
                const scenario = document.createElement('div');
                scenario.className = 'practice-scenario';
                scenario.textContent = exercise.scenario;
                body.appendChild(scenario);
            }
            renderPracticeDrag(body, exercise, zones, answerGetter);
        }

        function renderPracticeInventory(body, exercise) {
            const scenario = document.createElement('div');
            scenario.className = 'practice-scenario';
            scenario.textContent = exercise.scenario;
            body.appendChild(scenario);

            const table = document.createElement('table');
            table.className = 'practice-table';
            const totalUnits = exercise.layers.reduce((sum, row) => sum + Number(row.units || 0), 0);
            const totalCost = exercise.layers.reduce((sum, row) => sum + Number(row.total_cost || 0), 0);
            table.innerHTML = `
                <tr class="section-header"><td>Layer</td><td class="row-value">Units</td><td class="row-value">Unit Cost</td><td class="row-value">Total</td></tr>
                ${exercise.layers.map(row => `
                    <tr>
                        <td>${escapeHTML(row.layer_label)}</td>
                        <td class="row-value">${formatPracticeNumber(row.units)}</td>
                        <td class="row-value">${formatPracticeNumber(row.unit_cost)}</td>
                        <td class="row-value">${formatPracticeNumber(row.total_cost)}</td>
                    </tr>
                `).join('')}
                <tr class="subtotal"><td>Goods Available for Sale</td><td class="row-value">${formatPracticeNumber(totalUnits)}</td><td></td><td class="row-value">${formatPracticeNumber(totalCost)}</td></tr>
            `;
            body.appendChild(table);

            ['Summary', 'FIFO', 'LIFO'].forEach(method => {
                const rows = exercise.rows.filter(row => row.method === method);
                if (rows.length === 0) return;
                const card = document.createElement('div');
                card.className = 'practice-re-card practice-calc-card';
                card.innerHTML = `<div class="practice-drop-label">${escapeHTML(method)}</div>`;
                rows.forEach(row => {
                    const item = document.createElement('div');
                    item.className = 'practice-re-row';
                    item.innerHTML = `<span>${escapeHTML(row.line_label)}</span><input class="practice-input" type="number" step="0.01" placeholder="?" data-answer="${escapeHTML(row.answer)}" data-hint="${escapeHTML(row.hint || '')}">`;
                    card.appendChild(item);
                });
                body.appendChild(card);
            });
        }

        function renderPracticeBonds(body, exercise) {
            const scenario = document.createElement('div');
            scenario.className = 'practice-scenario';
            scenario.textContent = exercise.scenario;
            body.appendChild(scenario);

            const table = document.createElement('table');
            table.className = 'practice-table practice-bond-table';
            table.innerHTML = '<tr class="section-header"><td>Date</td><td class="row-value">Cash Payment</td><td class="row-value">Interest Expense</td><td class="row-value">Balance</td></tr>';
            exercise.rows.forEach(row => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${escapeHTML(row.date)}</td>
                    <td class="row-value">${renderPracticeBondCell(row.cash_payment, row.cash_is_blank, row.notes)}</td>
                    <td class="row-value">${renderPracticeBondCell(row.interest_expense, row.interest_is_blank, row.notes)}</td>
                    <td class="row-value">${renderPracticeBondCell(row.outstanding_balance, row.balance_is_blank, row.notes)}</td>
                `;
                table.appendChild(tr);
            });
            body.appendChild(table);
        }

        function renderPracticeScenarioMcq(body, exercise) {
            exercise.rows.forEach((row, idx) => {
                const card = document.createElement('div');
                card.className = 'practice-mcq-card';
                card.innerHTML = `
                    ${row.context ? `<div class="practice-scenario">${escapeHTML(row.context)}</div>` : ''}
                    <div class="practice-card-label">${escapeHTML(row.question)}</div>
                    <div class="practice-options">
                        ${row.options.map((option, optionIdx) => `
                            <button class="practice-option" type="button" data-row="${idx}" data-value="${optionIdx}">${escapeHTML(option)}</button>
                        `).join('')}
                    </div>
                    <div class="practice-explanation" id="practice-explain-${idx}">${escapeHTML(row.explanation)}</div>
                `;
                body.appendChild(card);
            });

            body.querySelectorAll('.practice-option').forEach(button => {
                button.addEventListener('click', event => {
                    const row = exercise.rows[Number(event.currentTarget.dataset.row)];
                    row._selected = Number(event.currentTarget.dataset.value);
                    event.currentTarget.closest('.practice-options').querySelectorAll('.practice-option').forEach(item => item.classList.remove('selected'));
                    event.currentTarget.classList.add('selected');
                });
            });
        }

        function renderPracticeFinancialStatementReader(body, exercise) {
            const grid = document.createElement('div');
            grid.className = 'practice-fs-grid';
            grid.appendChild(buildPracticeStatementPanel('Income Statement', 'Costco Wholesale, 2023, in millions', exercise.data.income));
            grid.appendChild(buildPracticeStatementPanel('Balance Sheet', 'Costco Wholesale, Sept. 3, 2023, in millions', exercise.data.balance));
            body.appendChild(grid);

            const label = document.createElement('div');
            label.className = 'practice-pool-label';
            label.textContent = 'Answer using the statements above';
            body.appendChild(label);

            const questionExercise = {
                ...exercise,
                rows: exercise.data.questions
            };
            renderPracticeScenarioMcq(body, questionExercise);
        }

        function buildPracticeStatementPanel(title, subtitle, rows) {
            const panel = document.createElement('div');
            panel.className = 'practice-fs-panel';
            panel.innerHTML = `<div class="practice-drop-label">${escapeHTML(title)}</div><div class="practice-drop-sub">${escapeHTML(subtitle)}</div>`;
            rows.forEach(row => {
                const line = document.createElement('div');
                line.className = [
                    'practice-fs-line',
                    row.is_indent === 'true' ? 'indent' : '',
                    row.is_total === 'true' ? 'total' : '',
                    row.is_section === 'true' ? 'section' : ''
                ].filter(Boolean).join(' ');
                line.innerHTML = `<span>${escapeHTML(row.line_label)}</span><span>${escapeHTML(row.value || '')}</span>`;
                panel.appendChild(line);
            });
            return panel;
        }

        function renderPracticeRatioTable(body, exercise) {
            const grid = document.createElement('div');
            grid.className = 'practice-fs-grid';
            grid.appendChild(buildPracticeFiguresPanel('Walmart Key Figures', exercise.walmartFigures));
            grid.appendChild(buildPracticeFiguresPanel('Costco Key Figures', exercise.costcoFigures));
            body.appendChild(grid);

            const wrap = document.createElement('div');
            wrap.className = 'practice-table-wrap';
            const table = document.createElement('table');
            table.className = 'practice-table practice-wide-table';
            table.innerHTML = '<tr class="section-header"><td>Ratio</td><td>Formula</td><td class="row-value">Walmart</td><td class="row-value">Costco</td></tr>';
            let category = '';
            exercise.rows.forEach((row, idx) => {
                if (row.category !== category) {
                    const header = document.createElement('tr');
                    header.className = 'section-header';
                    header.innerHTML = `<td colspan="4">${escapeHTML(row.category)} Ratios</td>`;
                    table.appendChild(header);
                    category = row.category;
                }
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><strong>${escapeHTML(row.ratio_label)}</strong></td>
                    <td class="practice-formula">${escapeHTML(row.formula)}</td>
                    <td class="row-value"><input class="practice-input" type="number" step="0.01" placeholder="?" data-answer="${escapeHTML(row.wmt_answer)}" data-hint="${escapeHTML(row.wmt_hint || '')}"></td>
                    <td class="row-value"><input class="practice-input" type="number" step="0.01" placeholder="?" data-answer="${escapeHTML(row.cst_answer)}" data-hint="${escapeHTML(row.cst_hint || '')}"></td>
                `;
                table.appendChild(tr);
            });
            wrap.appendChild(table);
            body.appendChild(wrap);

            const note = document.createElement('div');
            note.className = 'practice-drop-sub';
            note.textContent = 'Enter percentages as percentages, e.g. 6.6 not 0.066. Enter turnover/multiplier as x values and days ratios as days.';
            body.appendChild(note);
        }

        function buildPracticeFiguresPanel(title, rows) {
            const panel = document.createElement('div');
            panel.className = 'practice-fs-panel';
            panel.innerHTML = `<div class="practice-drop-label">${escapeHTML(title)}</div><div class="practice-drop-sub">Amounts in millions unless noted</div>`;
            rows.forEach(row => {
                const line = document.createElement('div');
                line.className = 'practice-fs-line indent';
                line.innerHTML = `<span>${escapeHTML(row.figure_label)}</span><span>${formatPracticeNumber(row.value)}</span>`;
                panel.appendChild(line);
            });
            return panel;
        }

        function renderPracticeCommonSize(body, exercise) {
            const scenario = document.createElement('div');
            scenario.className = 'practice-scenario';
            scenario.textContent = 'Micro Corporation: divide each line item by revenue for that year. Revenue equals 100%. Enter whole-number percentages.';
            body.appendChild(scenario);

            const wrap = document.createElement('div');
            wrap.className = 'practice-table-wrap';
            const table = document.createElement('table');
            table.className = 'practice-table practice-wide-table';
            table.innerHTML = '<tr class="section-header"><td>Line Item</td><td class="row-value">2018</td><td class="row-value">% 2018</td><td class="row-value">2017</td><td class="row-value">% 2017</td><td class="row-value">2016</td><td class="row-value">% 2016</td></tr>';
            exercise.rows.forEach(row => {
                const tr = document.createElement('tr');
                if (row.is_subtotal === 'true') tr.className = 'subtotal';
                const makePctCell = (value, pct) => {
                    if (row.is_blank === 'true') {
                        return `<input class="practice-input" type="number" step="0.01" placeholder="?" data-answer="${escapeHTML(pct)}" data-hint="${escapeHTML(`${value} / revenue x 100 = ${pct}%`)}">`;
                    }
                    return `${escapeHTML(pct)}%`;
                };
                tr.innerHTML = `
                    <td>${escapeHTML(row.line_label)}</td>
                    <td class="row-value">${formatPracticeNumber(row.val_2018)}</td>
                    <td class="row-value">${makePctCell(row.val_2018, row.pct_2018)}</td>
                    <td class="row-value">${formatPracticeNumber(row.val_2017)}</td>
                    <td class="row-value">${makePctCell(row.val_2017, row.pct_2017)}</td>
                    <td class="row-value">${formatPracticeNumber(row.val_2016)}</td>
                    <td class="row-value">${makePctCell(row.val_2016, row.pct_2016)}</td>
                `;
                table.appendChild(tr);
            });
            wrap.appendChild(table);
            body.appendChild(wrap);
        }

        function renderPracticeTrendStatement(body, exercise) {
            const scenario = document.createElement('div');
            scenario.className = 'practice-scenario';
            scenario.textContent = 'Micro Corporation: base year 2016 equals 100%. Calculate each trend percentage as year value divided by 2016 value times 100.';
            body.appendChild(scenario);

            const wrap = document.createElement('div');
            wrap.className = 'practice-table-wrap';
            const table = document.createElement('table');
            table.className = 'practice-table practice-wide-table';
            table.innerHTML = '<tr class="section-header"><td>Line Item</td><td class="row-value">2018</td><td class="row-value">Trend 2018</td><td class="row-value">2017</td><td class="row-value">Trend 2017</td><td class="row-value">2016</td><td class="row-value">Base</td></tr>';
            exercise.rows.forEach(row => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${escapeHTML(row.line_label)}</td>
                    <td class="row-value">${formatPracticeNumber(row.val_2018)}</td>
                    <td class="row-value"><input class="practice-input" type="number" step="0.01" placeholder="?" data-answer="${escapeHTML(row.trend_2018)}" data-hint="${escapeHTML(`${row.val_2018} / ${row.val_2016} x 100 = ${row.trend_2018}`)}"></td>
                    <td class="row-value">${formatPracticeNumber(row.val_2017)}</td>
                    <td class="row-value"><input class="practice-input" type="number" step="0.01" placeholder="?" data-answer="${escapeHTML(row.trend_2017)}" data-hint="${escapeHTML(`${row.val_2017} / ${row.val_2016} x 100 = ${row.trend_2017}`)}"></td>
                    <td class="row-value">${formatPracticeNumber(row.val_2016)}</td>
                    <td class="row-value">100%</td>
                `;
                table.appendChild(tr);
            });
            wrap.appendChild(table);
            body.appendChild(wrap);
        }

        function renderPracticeBondCell(value, isBlank, hint) {
            if (String(isBlank || '').toLowerCase() === 'true') {
                return `<input class="practice-input" type="number" step="0.01" placeholder="?" data-answer="${escapeHTML(value)}" data-hint="${escapeHTML(hint || '')}">`;
            }
            return formatPracticeNumber(value);
        }

        function formatPracticeNumber(value) {
            const number = Number(value);
            if (!Number.isFinite(number)) return escapeHTML(value);
            return number.toLocaleString(undefined, { maximumFractionDigits: 2 });
        }

        function persistPracticeResponses(exercise) {
            if (exercise.type === 'classify_type' || exercise.type === 'classify_stmt' || exercise.type === 'scenario_mcq' || exercise.type === 'fs_reader') {
                const rows = exercise.type === 'fs_reader' ? exercise.data.questions : exercise.rows;
                return;
            }

            const inputs = Array.from(document.querySelectorAll('.practice-input'));
            if (inputs.length > 0) {
                exercise._inputValues = inputs.map(input => input.value);
            }

            const chips = Array.from(document.querySelectorAll('.practice-chip'));
            if (chips.length > 0) {
                exercise._dragPlacements = {};
                chips.forEach(chip => {
                    const zone = chip.closest('.practice-drop-zone');
                    exercise._dragPlacements[chip.dataset.itemIndex] = zone ? zone.dataset.zone : '';
                });
            }
        }

        function restorePracticeResponses(exercise) {
            if (exercise.type === 'classify_type' || exercise.type === 'classify_stmt' || exercise.type === 'scenario_mcq' || exercise.type === 'fs_reader') {
                const rows = exercise.type === 'fs_reader' ? exercise.data.questions : exercise.rows;
                rows.forEach((row, idx) => {
                    if (!row._selected) return;
                    document.querySelectorAll(`.practice-option[data-row="${idx}"]`).forEach(button => {
                        if (String(button.dataset.value) === String(row._selected)) button.classList.add('selected');
                    });
                });
            }

            if (exercise._inputValues) {
                document.querySelectorAll('.practice-input').forEach((input, idx) => {
                    input.value = exercise._inputValues[idx] || '';
                });
            }

            if (exercise._dragPlacements) {
                document.querySelectorAll('.practice-chip').forEach(chip => {
                    const zoneKey = exercise._dragPlacements[chip.dataset.itemIndex];
                    if (!zoneKey) return;
                    const zone = document.querySelector(`.practice-drop-zone[data-zone="${cssEscape(zoneKey)}"]`);
                    if (zone) zone.appendChild(chip);
                });
            }
        }

        function markPracticeAnswers(exercise) {
            scorePracticeExercise(exercise, true);
        }

        function checkPracticeAnswers() {
            const exercise = activePracticeExercises[practiceIndex];
            persistPracticeResponses(exercise);

            if (!exercise._checked) {
                const result = scorePracticeExercise(exercise, true);
                exercise._checked = true;
                exercise._scoreCorrect = result.correct;
                exercise._scoreTotal = result.total;
            }

            finalizePracticeSet();
            updatePracticeScore();
            renderPracticeSidebar();
            renderPracticeExercise();
        }

        function scorePracticeExercise(exercise, markAnswers = false) {
            const feedback = document.getElementById('practice-feedback');
            let correct = 0;
            let total = 0;

            if (exercise.type === 'classify_type' || exercise.type === 'classify_stmt') {
                const answerKey = exercise.type === 'classify_type' ? 'account_type' : 'statement';
                exercise.rows.forEach((row, idx) => {
                    total++;
                    document.querySelectorAll(`.practice-option[data-row="${idx}"]`).forEach(button => {
                        const isAnswer = button.dataset.value === row[answerKey];
                        const isSelection = button.dataset.value === row._selected;
                        if (markAnswers && isAnswer) button.classList.add('correct');
                        if (markAnswers && isSelection && !isAnswer) button.classList.add('wrong');
                        if (isSelection && isAnswer) correct++;
                        if (markAnswers) button.disabled = true;
                    });
                });
            } else if (exercise.type === 'scenario_mcq' || exercise.type === 'fs_reader') {
                const rows = exercise.type === 'fs_reader' ? exercise.data.questions : exercise.rows;
                rows.forEach((row, idx) => {
                    total++;
                    document.querySelectorAll(`.practice-option[data-row="${idx}"]`).forEach(button => {
                        const optionIdx = Number(button.dataset.value);
                        const isAnswer = optionIdx === row.answer;
                        const isSelection = optionIdx === row._selected;
                        if (markAnswers && isAnswer) button.classList.add('correct');
                        if (markAnswers && isSelection && !isAnswer) button.classList.add('wrong');
                        if (isSelection && isAnswer) correct++;
                        if (markAnswers) button.disabled = true;
                    });
                    if (markAnswers) {
                        const explanation = document.getElementById(`practice-explain-${idx}`);
                        if (explanation) explanation.classList.add('visible');
                    }
                });
            } else if (['drag_bs', 'drag_cf', 'drag_cash', 'drag_ppe', 'drag_steps', 'drag_warranty'].includes(exercise.type)) {
                document.querySelectorAll('.practice-chip').forEach(chip => {
                    const zone = chip.closest('.practice-drop-zone');
                    total++;
                    if (zone && zone.dataset.zone === chip.dataset.correct) {
                        correct++;
                        if (markAnswers) chip.classList.add('correct');
                    } else {
                        if (markAnswers) {
                            chip.classList.add('wrong');
                            chip.title = `Correct: ${chip.dataset.correctLabel || chip.dataset.correct}`;
                            if (!chip.querySelector('.practice-answer-reveal')) {
                                const reveal = document.createElement('span');
                                reveal.className = 'practice-answer-reveal';
                                reveal.textContent = `Correct: ${chip.dataset.correctLabel || chip.dataset.correct}`;
                                chip.appendChild(reveal);
                            }
                        }
                    }
                });
            } else {
                document.querySelectorAll('.practice-input').forEach(input => {
                    total++;
                    const expected = Number(input.dataset.answer);
                    const hasValue = input.value.trim() !== '';
                    const actual = Number(input.value);
                    const tolerance = Math.abs(expected) < 2 ? 0.05 : Math.abs(expected) < 100 ? 0.5 : 1;
                    if (hasValue && Math.abs(actual - expected) <= tolerance) {
                        correct++;
                        if (markAnswers) {
                            input.classList.add('correct');
                            input.classList.remove('wrong');
                        }
                    } else {
                        if (markAnswers) {
                            input.classList.add('wrong');
                            input.classList.remove('correct');
                            if (!input.parentElement.querySelector('.practice-answer-reveal')) {
                                const reveal = document.createElement('span');
                                reveal.className = 'practice-answer-reveal';
                                reveal.textContent = `Answer: ${formatPracticeNumber(expected)}`;
                                input.parentElement.appendChild(reveal);
                            }
                        }
                    }
                });
            }

            return { correct, total };
        }

        function showCheckedPracticeResult(exercise) {
            const feedback = document.getElementById('practice-feedback');
            const correct = exercise._scoreCorrect || 0;
            const total = exercise._scoreTotal || 0;
            feedback.className = `practice-feedback show ${correct === total ? 'correct' : 'info'}`;
            feedback.textContent = `${correct} of ${total} correct.${practiceFinished ? ' Practice is finished; unattempted exercises are counted in the total score.' : ''}${correct === total ? ' Great job!' : ' Green marks the correct answer; red marks a wrong selection.'}`;
        }

        function updatePracticeScore() {
            const score = activePracticeExercises.reduce((acc, exercise) => {
                if (exercise._checked) {
                    acc.correct += exercise._scoreCorrect || 0;
                    acc.total += exercise._scoreTotal || 0;
                }
                return acc;
            }, { correct: 0, total: 0 });
            practiceScoreCorrect = score.correct;
            practiceScoreTotal = score.total;

            const correctEl = document.getElementById('practice-score-correct');
            const totalEl = document.getElementById('practice-score-total');
            if (correctEl) correctEl.textContent = practiceScoreCorrect;
            if (totalEl) totalEl.textContent = practiceScoreTotal;
        }

        function finalizePracticeSet() {
            activePracticeExercises.forEach(exercise => {
                if (exercise._checked) return;
                exercise._checked = true;
                exercise._scoreCorrect = 0;
                exercise._scoreTotal = countPracticePoints(exercise);
            });
            practiceFinished = true;
        }

        function countPracticePoints(exercise) {
            if (exercise.type === 'classify_type' || exercise.type === 'classify_stmt') {
                return (exercise.rows || []).length;
            }

            if (exercise.type === 'scenario_mcq') {
                return (exercise.rows || []).length;
            }

            if (exercise.type === 'fs_reader') {
                return (exercise.data?.questions || []).length;
            }

            if (['drag_bs', 'drag_cf', 'drag_cash', 'drag_ppe', 'drag_steps', 'drag_warranty'].includes(exercise.type)) {
                return (exercise.rows || []).length;
            }

            if (exercise.type === 'fill_calc') {
                return (exercise.parts || []).filter(part => !part.given).length;
            }

            if (exercise.type === 'ratio_table') {
                return (exercise.rows || []).length * 2;
            }

            if (exercise.type === 'common_size') {
                return (exercise.rows || []).filter(row => row.is_blank === 'true').length * 3;
            }

            if (exercise.type === 'trend_stmt') {
                return (exercise.rows || []).length * 2;
            }

            if (exercise.type === 'fill_inventory') {
                return (exercise.rows || []).length;
            }

            if (exercise.type === 'fill_bonds') {
                return (exercise.rows || []).reduce((sum, row) => {
                    return sum
                        + (String(row.cash_is_blank || '').toLowerCase() === 'true' ? 1 : 0)
                        + (String(row.interest_is_blank || '').toLowerCase() === 'true' ? 1 : 0)
                        + (String(row.balance_is_blank || '').toLowerCase() === 'true' ? 1 : 0);
                }, 0);
            }

            if (exercise.type === 'fill_is' || exercise.type === 'fill_cf' || exercise.type === 'fill_re') {
                return (exercise.rows || []).filter(row => String(row.is_blank || '').toLowerCase() === 'true').length;
            }

            return 0;
        }

        function renderPracticeScore() {
            updatePracticeScore();
            const percent = practiceScoreTotal ? Math.round((practiceScoreCorrect / practiceScoreTotal) * 100) : 0;
            container.innerHTML = `
                <div class="practice-shell score-shell">
                    <div class="score-card">
                        <div class="score-label">Practice Complete</div>
                        <div class="score-value">${practiceScoreCorrect} / ${practiceScoreTotal}</div>
                        <div class="score-percent">${percent}%</div>
                        <div class="score-detail">${activePracticeExercises.filter(exercise => exercise._checked).length} of ${activePracticeExercises.length} exercises checked</div>
                        <div class="score-actions">
                            <button id="practice-review" class="quiz-nav-button" type="button">Review</button>
                            <button id="practice-restart" class="quiz-nav-button primary" type="button">Restart</button>
                        </div>
                    </div>
                </div>
            `;
            document.getElementById('practice-review').addEventListener('click', () => {
                practiceFinished = false;
                practiceIndex = 0;
                renderPracticeExercise();
            });
            document.getElementById('practice-restart').addEventListener('click', restartPractice);
        }

        function showPracticeHint() {
            const exercise = activePracticeExercises[practiceIndex];
            const feedback = document.getElementById('practice-feedback');
            const hints = {
                classify_type: "Assets are owned resources. Liabilities are obligations. Equity is owners' claim. Revenue is income earned. Expenses are costs. Gains and losses are outside normal operations.",
                classify_stmt: 'Assets, liabilities, and equity belong on the balance sheet. Revenues, expenses, gains, and losses belong on the income statement.',
                drag_bs: 'Assets are ordered by liquidity; liabilities are ordered by maturity; equity has no required order here.',
                drag_cf: 'Operating covers day-to-day operations, investing covers long-term assets, and financing covers debt, stock, and dividends.',
                fill_is: 'Gross Profit = Revenue - COGS. Operating Income = Gross Profit - operating expenses. Net Income = income before taxes - tax expense.',
                fill_cf: 'Operating cash flow starts with net income, then adjusts for non-cash items and working capital. Investing is long-term assets. Financing is debt, stock, and dividends.',
                fill_re: 'Ending balance = beginning balance + additions - reductions.',
                drag_steps: 'The five steps are: identify contract, identify performance obligations, determine transaction price, allocate price, recognize revenue.',
                fill_calc: 'Use the scenario to build each amount from the prior line. Pay attention to percentages, time periods, and balances before adjustment.',
                drag_cash: 'Cash is currency and bank balances. Cash equivalents are highly liquid investments maturing in 3 months or less. Restricted cash is reported separately.',
                fill_inventory: 'FIFO sells oldest units first. LIFO sells newest units first. Ending inventory contains the layers not sold.',
                drag_ppe: 'Capitalize costs needed to acquire and prepare the asset. Expense future-period taxes, repairs, and routine maintenance.',
                fill_bonds: 'Cash payment uses the stated rate. Interest expense uses the market rate times carrying value. Discount bond balances increase toward face value.',
                scenario_mcq: 'Revenue needs both performance obligation satisfied and collection probable. Expenses are recorded in the period they help generate revenue.',
                drag_warranty: 'Assurance warranty is part of the original product sale. Extended warranty is a separate service obligation recognized over time.',
                fs_reader: 'Net means something was subtracted. Deferred means cash received but not earned. Accrued means earned or incurred but not yet paid.',
                ratio_table: 'Use average balance sheet figures for ROA, ROE, A/R days, inventory days, and payables days. Enter percentages as whole percentages.',
                common_size: 'Common-size means each line divided by revenue for that year times 100. Revenue is 100% by definition.',
                trend_stmt: 'Trend analysis means each line divided by the same line in the base year times 100. Here 2016 is the base year.'
            };
            feedback.className = 'practice-feedback show info';
            feedback.textContent = hints[exercise.type] || 'Review the related accounting relationships before checking your work.';
        }

        function nextPracticeExercise() {
            if (practiceFinished) return;

            const exercise = activePracticeExercises[practiceIndex];
            persistPracticeResponses(exercise);
            if (!exercise._checked) {
                const result = scorePracticeExercise(exercise, false);
                exercise._checked = true;
                exercise._scoreCorrect = result.correct;
                exercise._scoreTotal = result.total;
                updatePracticeScore();
            }

            if (practiceIndex < activePracticeExercises.length - 1) {
                practiceIndex++;
                renderPracticeExercise();
            } else {
                finalizePracticeSet();
                updatePracticeScore();
                renderPracticeSidebar();
                renderPracticeExercise();
            }
        }

        function previousPracticeExercise() {
            if (practiceIndex > 0) {
                practiceIndex--;
                renderPracticeExercise();
            }
        }

        function resetPracticeExercise() {
            const exercise = activePracticeExercises[practiceIndex];
            clearPracticeExerciseState(exercise);
            updatePracticeScore();
            renderPracticeExercise();
        }

        function clearPracticeExerciseState(exercise) {
            (exercise.rows || []).forEach(row => delete row._selected);
            (exercise.parts || []).forEach(part => delete part._selected);
            (exercise.data?.questions || []).forEach(row => delete row._selected);
            delete exercise._inputValues;
            delete exercise._dragPlacements;
            delete exercise._checked;
            delete exercise._scoreCorrect;
            delete exercise._scoreTotal;
        }

        function restartPractice() {
            activePracticeExercises.forEach(exercise => {
                clearPracticeExerciseState(exercise);
            });
            practiceIndex = 0;
            practiceFinished = false;
            updatePracticeScore();
            renderPracticeSidebar();
            renderPracticeExercise();
        }

        function normalizePracticeKey(value) {
            return String(value || '').toLowerCase().replace(/[^a-z]/g, '');
        }

        // Controls
        function collapseAll() {
            forestRoots.forEach(r => {
                function collapse(node) {
                    node._collapsed = true;
                    node._visibleChildren = [];
                    node._persistent = false;
                    node.children.forEach(collapse);
                }
                collapse(r);
            });
            clickedNode = null;
            focusedNode = null;
            currentSidebarNode = null;
            nodeId = 0;
            updateRootPositions();
            getActiveRoots().forEach((root, idx) => assignIds(root, 0, idx));
            render();
            updateRouteBar(null);
            setTimeout(() => centerOnRoots(), 100);
        }

        function resetZoom() {
            centerOnRoots();
        }

        function bindControls() {
            document.getElementById('accounting-button').addEventListener('click', switchToQuiz);
            document.querySelector('.view-tabs').addEventListener('click', event => {
                const tab = event.target.closest('.view-tab');
                if (!tab) return;
                if (tab.id === 'quiz-view-button') switchToQuiz();
                if (tab.id === 'mindmap-view-button') switchToMindmap();
                if (tab.id === 'practice-view-button') switchToPractice();
            });
            document.getElementById('collapse-button').addEventListener('click', collapseAll);
            document.getElementById('reset-button').addEventListener('click', resetZoom);
            document.getElementById('clear-button').addEventListener('click', clearSelection);
        }

        // Center view on both root nodes - CLOSER ZOOM
        function centerOnRoots() {
            if (!svg || !zoom) return;

            const fullWidth = treePanel.clientWidth;
            const fullHeight = treePanel.clientHeight;

            const rootX = rootPositions.reduce((sum, pos) => sum + pos.x, 0) / rootPositions.length;
            const rootY = rootPositions.reduce((sum, pos) => sum + pos.y, 0) / rootPositions.length;

            const rootDistance = rootPositions.reduce((maxDistance, pos) => {
                const distance = Math.hypot(pos.x - rootX, pos.y - rootY);
                return Math.max(maxDistance, distance);
            }, getLayoutMetrics().baseSize);

            const bounds = visibleBounds || {
                minX: rootX - rootDistance,
                maxX: rootX + rootDistance,
                minY: rootY - rootDistance,
                maxY: rootY + rootDistance
            };
            const boundsWidth = Math.max(1, bounds.maxX - bounds.minX);
            const boundsHeight = Math.max(1, bounds.maxY - bounds.minY);
            const boundsCenterX = (bounds.minX + bounds.maxX) / 2;
            const boundsCenterY = (bounds.minY + bounds.maxY) / 2;
            const padding = fullWidth <= 800 ? 56 : 96;
            const fitScale = Math.min(
                (fullWidth - padding) / boundsWidth,
                (fullHeight - padding) / boundsHeight
            );
            const scale = Math.max(0.18, Math.min(getLayoutMetrics().maxScale, fitScale));

            const translate = [fullWidth / 2 - scale * boundsCenterX, fullHeight / 2 - scale * boundsCenterY];

            const transform = d3.zoomIdentity
                .translate(translate[0], translate[1])
                .scale(scale);

            svg.transition().duration(600).call(zoom.transform, transform);
        }

        // Initial render and center on roots
        bindControls();
        initializeTreeCanvas();
        render();
        setTimeout(centerOnRoots, 50);
        loadAccountingQuizCSV();

        // Resize
        window.addEventListener('resize', () => {
            const newWidth = treePanel.clientWidth;
            const newHeight = treePanel.clientHeight;
            if (currentView === 'practice') {
                renderPracticeExercise();
                return;
            }
            if (currentView === 'quiz') {
                renderQuizQuestion();
                return;
            }
            if (!svg) {
                initializeTreeCanvas();
            }
            svg.attr("width", newWidth).attr("height", newHeight);
            updateRootPositions();
            render();
            setTimeout(centerOnRoots, 100);
        });


