/**
 * Screenshot Masking Quiz Application - 最適化 & スマホ対応版
 * * 主な改善点：
 * 1. スマホモード搭載：タップ操作による快適な解答体験を実現。PC/スマホモードの切り替え機能。
 * 2. パフォーマンス最適化：DOM操作の効率化、イベントリスナーの最適管理。
 * 3. コード品質向上：命名規則の統一、関数の責務分離、可読性の高い構造へリファクタリング。
 * 4. 既存機能の維持：派手なアニメーションや全てのクイズ機能を完全に保持。
 */
document.addEventListener('DOMContentLoaded', () => {
    'use strict';

    const DB_NAME = 'QuizAppDB';
    const DB_VERSION = 1;
    const STORE_NAME = 'quizBooks';
    let db;

    // --- 1. State Management (スマホモード対応) ---
    const AppState = {
        masterQuizList: [],
        isDataLoaded: false,
        currentMode: 'menu',
        currentQuizBookId: null,
        currentProblemIndexCreation: 0,
        currentProblemIndexExercise: 0,
        isSelecting: false,
        currentSelectionRect: null,
        exerciseData: [], 
        originalExerciseProblems: [],
        exerciseRound: 1,
        isFirstRound: true,
        importanceSelectMode: false,
        selectedImportance: '☆',
        isGroupSelectMode: false,
        selectedGroupId: null,
        isPanning: false,
        panStart: { x: 0, y: 0 },
        panStartScroll: { left: 0, top: 0 },
        speechRecognition: null,
        isRecognizing: false,
        currentAnsweringMaskId: null,
                exerciseFitMode: 'contain', // 'contain' = 全体表示 / 'height' = 縦いっぱい / 'width' = 横いっぱい

        isModalOpen: false,
        problemToAction: { sourceBookId: null, quizId: null },
        shouldShuffleOptions: true,
        currentOptionOrder: [],
        isMobileMode: false, // スマホモードの状態
        selectedMaskForMobile: null, // スマホモードで選択中のマスクID

        stampMode: false,            // ★追加：クリックで直前と同じサイズのマスクを置く
        lastMaskSize: null,          // ★追加：直前に作ったマスクの相対サイズ

        // キャッシュ用変数
        _currentQuizBookCache: null,
        _currentCreationQuizCache: null,

        getCurrentQuizBook() {
            if (this._currentQuizBookCache?.id === this.currentQuizBookId) {
                return this._currentQuizBookCache;
            }
            this._currentQuizBookCache = this.masterQuizList.find(qb => qb.id === this.currentQuizBookId);
            return this._currentQuizBookCache;
        },
        getCurrentCreationQuiz() {
            const book = this.getCurrentQuizBook();
            if (!book?.quizzes) return null;
            const quiz = book.quizzes[this.currentProblemIndexCreation];
            if (this._currentCreationQuizCache?.id === quiz?.id) {
                return this._currentCreationQuizCache;
            }
            this._currentCreationQuizCache = quiz;
            return quiz;
        },
        getCurrentExerciseQuiz() {
            return this.exerciseData[this.currentProblemIndexExercise];
        },
        clearCache() {
            this._currentQuizBookCache = null;
            this._currentCreationQuizCache = null;
        }
    };

    // --- 2. DOM Element Cache (スマホモード対応) ---
    const DOM = (() => {
        const elements = {};
        const elementIds = [
            'loadingOverlay', 'menuModeDiv', 'quizBookSelectionModeDiv', 'problemManagementModeDiv',
            'creationModeDiv', 'exerciseModeDiv', 'imageCanvas', 'imageCanvasExercise',
            'quizBookSelectionContainer', 'problemListContainerTop', 'optionsContainerCreation',
            'optionsContainerExercise', 'dropZoneContainerExercise', 'dropZoneAndButtonContainerCreation',
            'imageContainerWrapperExercise', 'imageDisplayAreaExercise', 'exerciseTextInputContainer',
            'addNewQuizInput', 'selectionRectangle', 'messageArea', 'globalHeaderInfo',
            'prevProblemButton', 'nextProblemButton', 'prevProblemCreationButton', 'nextProblemCreationButton',
            'problemCounter', 'problemCounterCreation', 'zoomSlider', 'zoomValue',
            'problemManagementTitle', 'currentCreatingQuizTitle', 'currentExerciseQuizTitle',
            'retryProblemButton', 'problemActionModal', 'modalProblemTitle', 'targetQuizBookSelect',
            'moveProblemButton', 'importFromJsonInput', 'toggleMobileModeButton' // スマホモード切替ボタン
        ];
        elementIds.forEach(id => {
            elements[id] = document.getElementById(id);
        });
        return elements;
    })();

    // --- 3. Database Manager (変更なし) ---
    const DBManager = {
        async initDB() {
            db = await idb.openDB(DB_NAME, DB_VERSION, {
                upgrade(db) {
                    if (!db.objectStoreNames.contains(STORE_NAME)) {
                        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                    }
                },
            });
            console.log("Database initialized.");
        },
        async loadAllQuizBooks() {
            AppState.masterQuizList = await db.getAll(STORE_NAME);
            AppState.isDataLoaded = true;
            AppState.clearCache();
            DOM.loadingOverlay.classList.add('mode-hidden');
            console.log("📚 Data loaded from IndexedDB.");
        },
        async addQuizBook(book) {
            const cleanBook = JSON.parse(JSON.stringify(book));
            await db.add(STORE_NAME, cleanBook);
            AppState.clearCache();
        },
        async updateQuizBook(book) {
            const cleanBook = JSON.parse(JSON.stringify(book));
            await db.put(STORE_NAME, cleanBook);
            AppState.clearCache();
        },
        async deleteQuizBook(bookId) {
            await db.delete(STORE_NAME, bookId);
            AppState.clearCache();
        },
        async importFromFile(file) {
            if (!file) return;
            const text = await file.text();
            try {
                const data = JSON.parse(text);
                const booksToImport = Array.isArray(data) ? data : [data];
                
                const tx = db.transaction(STORE_NAME, 'readwrite');
                await Promise.all(booksToImport.map(book => {
                    if (!book.id) book.id = Utils.generateId();
                    if (!book.quizzes) book.quizzes = [];
                    const cleanBook = JSON.parse(JSON.stringify(book));
                    return tx.store.put(cleanBook);
                }));
                await tx.done;

                await this.loadAllQuizBooks();
                UIManager.switchToMode('quizBookSelection');
                Utils.updateMessage(`${booksToImport.length}件の問題集をインポートしました。`, "success");
            } catch (error) {
                console.error("Import failed:", error);
                Utils.updateMessage("ファイルのインポートに失敗しました。形式が正しくない可能性があります。", "error");
            }
        }
    };
    
    // --- 4. Utility Functions (変更なし) ---
    const Utils = {
        generateId: () => `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        
        updateMessage(text, type = 'info') {
            if (!DOM.messageArea) return;
            const typeClasses = { 
                success: 'bg-green-100 border border-green-300 text-green-700', 
                error: 'bg-red-100 border border-red-300 text-red-700', 
                info: 'bg-blue-100 border border-blue-300 text-blue-700' 
            };
            DOM.messageArea.textContent = text;
            DOM.messageArea.className = `mt-6 font-medium p-3 rounded-lg shadow-sm text-center ${typeClasses[type] || typeClasses.info}`;
        },
        
        blobToDataURL(blob) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        },
                // ★追加：取り込む画像が大きすぎる場合だけ縮小する（容量削減）
        shrinkImage(file, maxWidth = 1600, quality = 0.88) {
            return new Promise(async (resolve, reject) => {
                try {
                    const src = await this.blobToDataURL(file);
                    const img = new Image();
                    img.onload = () => {
                        if (img.naturalWidth <= maxWidth) return resolve(src);
                        const scale = maxWidth / img.naturalWidth;
                        const c = document.createElement('canvas');
                        c.width = Math.round(img.naturalWidth * scale);
                        c.height = Math.round(img.naturalHeight * scale);
                        const ctx = c.getContext('2d');
                        ctx.imageSmoothingQuality = 'high';
                        ctx.fillStyle = '#ffffff';
                        ctx.fillRect(0, 0, c.width, c.height);
                        ctx.drawImage(img, 0, 0, c.width, c.height);
                        resolve(c.toDataURL('image/jpeg', quality));
                    };
                    img.onerror = () => resolve(src);
                    img.src = src;
                } catch (e) { reject(e); }
            });
        },
        downloadJSON(data, filename) {
            const dataToExport = JSON.parse(JSON.stringify(data));
            const cleanup = (quizObj) => {
                delete quizObj.originalImage;
                delete quizObj.grayscaleImage;
            };

            if (Array.isArray(dataToExport)) {
                dataToExport.forEach(book => book.quizzes?.forEach(cleanup));
            } else if (dataToExport.quizzes) {
                dataToExport.quizzes.forEach(cleanup);
            } else if (dataToExport.originalImageData) {
                cleanup(dataToExport);
            }

            const jsonStr = JSON.stringify(dataToExport, null, 2);
            const blob = new Blob([jsonStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        },
        
        normalizeNumbers(str) {
            return str ? str.replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0)) : '';
        },
        // ★追加：比較用に表記ゆれを吸収する
        normalizeForCompare(str) {
            if (str === null || str === undefined) return '';
            let s = String(str);
            try { s = s.normalize('NFKC'); } catch (e) {}
            s = s.toLowerCase();
            // カタカナ → ひらがな
            s = s.replace(/[\u30a1-\u30f6]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
            // 先頭の口ぐせを除去
            s = s.replace(/^(えーと|えっと|ええと|あのー|たぶん|多分|たしか|確か|こたえは|答えは)+/g, '');
            // 末尾の言い回しを除去
            s = s.replace(/(です|でーす|ですね|だと思います|かなあ|かな)+$/g, '');
            // 記号・空白・長音などを除去
            s = s.replace(/[\s\u3000ー－―‐・、。，．,.\-_!！?？"'「」『』（）()\[\]【】:：;；]/g, '');
            return s;
        },

        // ★追加：2つの文字列の編集距離
        levenshtein(a, b) {
            if (a === b) return 0;
            if (!a.length) return b.length;
            if (!b.length) return a.length;
            let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
            for (let i = 1; i <= a.length; i++) {
                const cur = [i];
                for (let j = 1; j <= b.length; j++) {
                    cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
                }
                prev = cur;
            }
            return prev[b.length];
        },

        // ★追加：あいまい一致（tolerance を上げるほどゆるくなる）
        looseMatch(input, maskText, tolerance = 0.25) {
            const a = this.normalizeForCompare(input);
            if (!a) return false;
            return String(maskText || '').split(/[、,／/｜|]/).some(part => {
                const b = this.normalizeForCompare(part);
                if (!b) return false;
                if (a === b) return true;
                if (b.length >= 2 && a.includes(b)) return true;   // 余計な語がついても可
                const dist = this.levenshtein(a, b);
                if (b.length <= 2) return false;                   // 短い語は誤爆防止で厳密に
                if (b.length <= 5) return dist <= 1;               // 1文字違いまで許容
                return dist / Math.max(a.length, b.length) <= tolerance;
            });
        },


        createConfettiEffect(container, options = {}) {
            const { count = 80, colors = ['#ff6b9d', '#4ecdc4', '#45b7d1', '#96ceb4', '#ffeaa7'], duration = 4000 } = options;
            for (let i = 0; i < count; i++) {
                const confetti = document.createElement('div');
                const color = colors[Math.floor(Math.random() * colors.length)];
                const size = Math.random() * 12 + 6;
                confetti.style.cssText = `position: absolute; left: ${Math.random() * 100}%; top: -20px; width: ${size}px; height: ${size * 0.6}px; background: ${color}; border-radius: 2px; pointer-events: none; z-index: 10000; transform: rotate(${Math.random() * 360}deg); animation: confettiFall ${duration}ms ease-out forwards; animation-delay: ${Math.random() * 1500}ms;`;
                container.appendChild(confetti);
                setTimeout(() => confetti.remove(), duration + 2500);
            }
        },

        createSparkleEffect(container, options = {}) {
            const { count = 30, colors = ['#ffd700', '#ffed4e', '#fff200'], duration = 3000 } = options;
            for (let i = 0; i < count; i++) {
                const sparkle = document.createElement('div');
                const color = colors[Math.floor(Math.random() * colors.length)];
                sparkle.textContent = '✨';
                sparkle.style.cssText = `position: absolute; left: ${Math.random() * 100}%; top: ${Math.random() * 100}%; font-size: ${Math.random() * 16 + 8}px; color: ${color}; pointer-events: none; z-index: 10001; filter: drop-shadow(0 0 6px ${color}); animation: sparkleFloat ${duration}ms ease-in-out infinite; animation-delay: ${Math.random() * 2000}ms;`;
                container.appendChild(sparkle);
                setTimeout(() => sparkle.remove(), duration + 2000);
            }
        }
    };

    // --- 5. UI Manager (スマホモード対応) ---
    const UIManager = {
        switchToMode(mode, options = {}) {
            if (!AppState.isDataLoaded) { 
                setTimeout(() => this.switchToMode(mode, options), 100); 
                return; 
            }

            if (AppState.currentMode === 'exercise' && mode !== 'exercise') SpeechManager.stop();

            this.clearBulkSelectModes();
            AppState.currentMode = mode;
            document.querySelectorAll('.mode-container').forEach(div => div.classList.add('mode-hidden'));
            
            let currentBookName = AppState.getCurrentQuizBook()?.name || '';
            const exerciseTitle = AppState.isMobileMode ? '（タップ操作）' : '（ドラッグ＆ドロップまたはテキスト入力）';

            const modeActions = {
                menu: () => {
                    DOM.menuModeDiv.classList.remove('mode-hidden');
                    Utils.updateMessage('メニューから操作を選択してください。');
                    currentBookName = '';
                },
                quizBookSelection: () => {
                    DOM.quizBookSelectionModeDiv.classList.remove('mode-hidden');
                    this.refreshQuizBookList();
                    Utils.updateMessage('問題集を選択または作成してください。');
                    currentBookName = '';
                },
                problemManagement: () => {
                    DOM.problemManagementModeDiv.classList.remove('mode-hidden');
                    this.refreshProblemList();
                    Utils.updateMessage('問題を管理してください。');
                },
                creation: () => {
                    DOM.creationModeDiv.classList.remove('mode-hidden');
                    const book = AppState.getCurrentQuizBook();
                    const quizIndex = book?.quizzes.findIndex(q => q.id === options.quizId);
                    if (book && quizIndex > -1) {
                        AppState.currentProblemIndexCreation = quizIndex;
                        CanvasManager.loadImageFromQuizData(book.quizzes[quizIndex], DOM.imageCanvas);
                    } else {
                        this.switchToMode('problemManagement');
                        return;
                    }
                    Utils.updateMessage('画像上でマスキングする範囲をドラッグしてください。', 'success');
                },
                exercise: () => {
                    DOM.exerciseModeDiv.classList.remove('mode-hidden');
                    if (options.problems) ExerciseModeManager.startExerciseMode(options.problems);
                    Utils.updateMessage(`演習を開始してください。${exerciseTitle}`, 'success');
                }
            };
            
            modeActions[mode]?.();
            DOM.globalHeaderInfo.textContent = currentBookName;
        },

                clearBulkSelectModes() {
            AppState.importanceSelectMode = false;
            AppState.isGroupSelectMode = false;
            document.querySelectorAll('.importance-setter-btn').forEach(b => b.classList.remove('bg-blue-500', 'text-white'));
            document.querySelectorAll('.group-setter-btn').forEach(b => b.classList.remove('bg-green-500', 'text-white'));
        },


        refreshQuizBookList() {
            const container = DOM.quizBookSelectionContainer;
            if (!container) return;
            container.innerHTML = '';
            if (AppState.masterQuizList.length === 0) {
                container.innerHTML = '<p class="text-gray-500 text-center">作成された問題集はありません。</p>';
                return;
            }
            const fragment = document.createDocumentFragment();
            [...AppState.masterQuizList].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)).forEach(quizBook => {
                const problemCount = quizBook.quizzes?.reduce((total, quiz) => total + (quiz.problemData?.length || 0), 0) || 0;
                fragment.appendChild(this.createQuizBookElement(quizBook, problemCount));
            });
            container.appendChild(fragment);
        },

        createQuizBookElement(quizBook, problemCount) {
            const el = document.createElement('div');
            el.className = 'quiz-book-item border border-gray-200 p-4 rounded-lg bg-white shadow-sm hover:shadow-md transition-shadow';
            el.innerHTML = `<div class="flex justify-between items-center"><div><h3 class="text-lg font-semibold text-gray-800">${quizBook.name}</h3><p class="text-sm text-gray-600">問題数: ${quizBook.quizzes?.length || 0} / マスク数: ${problemCount}</p><p class="text-xs text-gray-500">作成日: ${new Date(quizBook.createdAt).toLocaleDateString()}</p></div><div class="space-x-2"><button class="px-3 py-1 bg-teal-500 text-white rounded hover:bg-teal-600 text-sm" data-action="export-book" data-book-id="${quizBook.id}">エクスポート</button><button class="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 text-sm" data-action="select-book" data-book-id="${quizBook.id}">選択</button><button class="px-3 py-1 bg-yellow-500 text-white rounded hover:bg-yellow-600 text-sm" data-action="rename-book" data-book-id="${quizBook.id}">名前変更</button><button class="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600 text-sm" data-action="delete-book" data-book-id="${quizBook.id}">削除</button></div></div>`;
            return el;
        },

                refreshProblemList() {
            const container = DOM.problemListContainerTop;
            const quizBook = AppState.getCurrentQuizBook();
            if (!container || !quizBook) {
                if (container) container.innerHTML = '<p class="text-gray-500 text-center">問題集が見つかりません。</p>';
                return;
            }
            DOM.problemManagementTitle.textContent = `問題管理: ${quizBook.name}`;
            container.innerHTML = '';
            const quizzes = quizBook.quizzes || [];
            if (quizzes.length === 0) {
                container.innerHTML = '<p class="text-gray-500 text-sm text-center">問題がありません。「新しい問題を追加」から画像を追加してください。</p>';
                return;
            }
            const fragment = document.createDocumentFragment();

            // ★追加：全選択バー
            const bar = document.createElement('div');
            bar.className = 'flex items-center gap-2 mb-3 p-2 bg-blue-50 border border-blue-200 rounded';
            bar.innerHTML = `<label class="flex items-center cursor-pointer text-sm font-semibold">`
                + `<input type="checkbox" id="selectAllProblemsCb" class="h-5 w-5 mr-2 text-blue-600" data-action="toggle-select-all-problems">`
                + `すべての問題を選択</label>`
                + `<span id="selectedProblemCount" class="text-xs text-gray-600 ml-auto">0 / ${quizzes.length} 件選択中</span>`;
            fragment.appendChild(bar);

            quizzes.forEach(quiz => fragment.appendChild(this.createProblemElement(quiz)));
            container.appendChild(fragment);

            // ★追加：個別チェックの変更で件数表示を更新
            container.onchange = (e) => {
                if (e.target.classList && e.target.classList.contains('problem-select-cb')) {
                    this.updateSelectedProblemCount();
                }
            };
            this.updateSelectedProblemCount();
        },

        updateSelectedProblemCount() {
            const all = document.querySelectorAll('.problem-select-cb');
            const checked = document.querySelectorAll('.problem-select-cb:checked');
            const label = document.getElementById('selectedProblemCount');
            if (label) label.textContent = `${checked.length} / ${all.length} 件選択中`;
            const master = document.getElementById('selectAllProblemsCb');
            if (master) {
                master.checked = all.length > 0 && checked.length === all.length;
                master.indeterminate = checked.length > 0 && checked.length < all.length;
            }
        },


        createProblemElement(quiz) {
            const el = document.createElement('div');
            el.className = 'problem-item border border-gray-200 p-3 rounded bg-white hover:bg-gray-50 transition-colors flex items-center';
            el.dataset.quizId = quiz.id;
            el.innerHTML = `<div class="flex items-center flex-grow mr-4"><input type="checkbox" class="problem-select-cb h-5 w-5 mr-4 flex-shrink-0 text-blue-600" data-quiz-id="${quiz.id}" id="cb-${quiz.id}"><label for="cb-${quiz.id}" class="flex-grow cursor-pointer"><h4 class="font-medium text-gray-800">${quiz.title}</h4><p class="text-sm text-gray-600">マスク数: ${quiz.problemData?.length || 0}</p></label></div><div class="space-x-1 flex-shrink-0 ml-auto"><button class="px-2 py-1 bg-teal-500 text-white rounded hover:bg-teal-600 text-xs" data-action="export-problem">エクスポート</button><button class="px-2 py-1 bg-purple-500 text-white rounded hover:bg-purple-600 text-xs" data-action="open-problem-action-modal">操作...</button><button class="px-2 py-1 bg-yellow-500 text-white rounded hover:bg-yellow-600 text-xs" data-action="rename-problem">名前変更</button><button class="px-2 py-1 bg-green-500 text-white rounded hover:bg-green-600 text-xs" data-action="exercise-problem">演習</button><button class="px-2 py-1 bg-gray-600 text-white rounded hover:bg-gray-700 text-xs" data-action="edit-problem">編集</button><button class="px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600 text-xs" data-action="delete-problem">削除</button></div>`;
            return el;
        },

        initializeGroupButtons() {
            const container = document.getElementById('groupSetterButtons');
            if (!container) return;
            container.innerHTML = '';
            const fragment = document.createDocumentFragment();
            ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'].forEach(group => {
                const btn = document.createElement('button');
                btn.className = 'group-setter-btn px-2 py-1 text-xs rounded border w-7 h-7 flex items-center justify-center font-mono';
                btn.textContent = group;
                btn.dataset.action = 'set-group';
                btn.dataset.groupId = group;
                fragment.appendChild(btn);
            });
            container.appendChild(fragment);
        },

        toggleProblemActionModal(show, quizId = null) {
            if (show && quizId) {
                const sourceBook = AppState.getCurrentQuizBook();
                const quiz = sourceBook.quizzes.find(q => q.id === quizId);
                if (!quiz) return;
                
                AppState.isModalOpen = true;
                AppState.problemToAction = { sourceBookId: sourceBook.id, quizId: quiz.id };
                DOM.modalProblemTitle.textContent = `問題「${quiz.title}」を操作します。`;
                
                DOM.targetQuizBookSelect.innerHTML = '';
                AppState.masterQuizList.forEach(book => {
                    const option = document.createElement('option');
                    option.value = book.id;
                    option.textContent = book.name;
                    DOM.targetQuizBookSelect.appendChild(option);
                });
                
                DOM.moveProblemButton.disabled = AppState.masterQuizList.length <= 1;
                DOM.problemActionModal.classList.remove('mode-hidden');
            } else {
                AppState.isModalOpen = false;
                DOM.problemActionModal.classList.add('mode-hidden');
            }
        },

        updateCreationNavigation() {
            const quizBook = AppState.getCurrentQuizBook();
            const quizzes = quizBook?.quizzes || [];
            if (!DOM.problemCounterCreation || quizzes.length === 0) {
                if(DOM.problemCounterCreation) DOM.problemCounterCreation.textContent = '0 / 0';
                if(DOM.currentCreatingQuizTitle) DOM.currentCreatingQuizTitle.textContent = '問題がありません';
                DOM.prevProblemCreationButton.disabled = true;
                DOM.nextProblemCreationButton.disabled = true;
                return;
            }
            DOM.problemCounterCreation.textContent = `${AppState.currentProblemIndexCreation + 1} / ${quizzes.length}`;
            const currentQuiz = quizzes[AppState.currentProblemIndexCreation];
            DOM.currentCreatingQuizTitle.textContent = currentQuiz ? `編集中: ${currentQuiz.title}` : '問題を選択してください';
            DOM.prevProblemCreationButton.disabled = AppState.currentProblemIndexCreation === 0;
            DOM.nextProblemCreationButton.disabled = AppState.currentProblemIndexCreation >= quizzes.length - 1;
        },

        updateExerciseNavigation() {
            if (!DOM.problemCounter) return;
            const total = AppState.exerciseData.length;
            const current = AppState.currentProblemIndexExercise + 1;
            DOM.problemCounter.textContent = `${current} / ${total}`;
            const currentQuiz = AppState.getCurrentExerciseQuiz();
            DOM.currentExerciseQuizTitle.textContent = currentQuiz.title;
            DOM.prevProblemButton.disabled = AppState.currentProblemIndexExercise === 0;
            DOM.nextProblemButton.disabled = AppState.currentProblemIndexExercise >= total - 1;
        },

        showAnimation(maskId, type) {
            const dropZone = DOM.dropZoneContainerExercise.querySelector(`[data-mask-id="${maskId}"]`);
            if (!dropZone) return;
            const animElement = document.createElement('div');
            animElement.textContent = type === 'correct' ? '○' : '×';
            animElement.className = type === 'correct' ? 'correct-o-animation' : 'incorrect-x-animation';
            dropZone.appendChild(animElement);
            setTimeout(() => animElement.remove(), type === 'correct' ? 1000 : 1200);
        },

        showSpectacularClearAnimation(isAllComplete = false) {
            const existingOverlay = document.getElementById('clearAnimationOverlay');
            if (existingOverlay) existingOverlay.remove();

            const overlay = document.createElement('div');
            overlay.id = 'clearAnimationOverlay';
            overlay.style.cssText = `position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 9999; pointer-events: auto; display: flex; align-items: center; justify-content: center; background: rgba(0, 0, 0, 0.4); backdrop-filter: blur(3px); cursor: pointer;`;
            
            const removeOverlay = () => {
                if (overlay.parentNode) {
                    overlay.style.opacity = '0';
                    overlay.style.transition = 'opacity 0.5s ease-out';
                    setTimeout(() => overlay.remove(), 500);
                }
                document.removeEventListener('keydown', removeOverlay);
            };
            overlay.addEventListener('click', removeOverlay);
            document.addEventListener('keydown', removeOverlay);

            if (isAllComplete) {
                overlay.innerHTML = `<div class="all-complete-spectacular text-center p-12 relative overflow-hidden bg-white rounded-3xl shadow-2xl max-w-2xl mx-4"><div class="trophy-bounce text-9xl mb-6 filter drop-shadow-lg">🏆</div><div class="text-6xl font-bold mb-4 bg-gradient-to-r from-yellow-400 via-red-500 to-pink-500 bg-clip-text text-transparent animate-pulse">PERFECT CLEAR!</div><div class="text-3xl font-bold text-purple-600 mb-4 animate-bounce">🎉 ALL COMPLETE! 🎉</div><div class="text-xl text-gray-700">全ての問題を完了しました！<br><span class="text-yellow-600 font-bold text-2xl">CONGRATULATIONS!</span></div></div>`;
                Utils.updateMessage('🏆✨ PERFECT! 全ての問題を完全制覇しました！ ✨🏆', 'success');
                setTimeout(() => {
                    Utils.createConfettiEffect(overlay, { count: 150, duration: 6000 });
                    Utils.createSparkleEffect(overlay, { count: 50, duration: 5000 });
                }, 500);
            } else {
                const currentProblem = AppState.currentProblemIndexExercise + 1;
                const totalProblems = AppState.exerciseData.length;
                overlay.innerHTML = `<div class="problem-clear-spectacular text-center p-10 relative bg-white rounded-2xl shadow-xl max-w-xl mx-4"><div class="clear-burst text-8xl mb-6">🎯</div><div class="text-4xl font-bold text-green-600 mb-4 clear-text-glow">✨ STAGE CLEAR! ✨</div><div class="text-2xl text-purple-600 font-bold mb-6">🎊 問題クリア! 🎊</div><div class="text-lg text-gray-700">「前の問題」「次の問題」ボタンで移動してください</div><div class="progress-celebration mt-4 text-yellow-500 text-3xl">🌟 進捗: ${Math.round((currentProblem / totalProblems) * 100)}% 🌟</div></div>`;
                Utils.updateMessage('🎯 STAGE CLEAR! 次の問題へ進んでください。', 'success');
                setTimeout(() => {
                    Utils.createConfettiEffect(overlay, { count: 80, duration: 4000 });
                    Utils.createSparkleEffect(overlay, { count: 25, duration: 3500 });
                }, 300);
            }

            document.body.appendChild(overlay);
            setTimeout(removeOverlay, 15000);

            const container = DOM.optionsContainerExercise;
            if (container) {
                container.innerHTML = `<div class="text-center p-6 bg-gradient-to-r from-${isAllComplete ? 'purple' : 'green'}-100 to-${isAllComplete ? 'pink' : 'blue'}-100 rounded-lg"><div class="text-3xl mb-2">${isAllComplete ? '🏆' : '🎯'}</div><div class="text-lg font-bold text-${isAllComplete ? 'purple' : 'green'}-600">${isAllComplete ? '全問題完了！' : 'ステージクリア！'}</div></div>`;
            }
        }
    };

        // --- 5.5 PDF Manager (★新規追加) ---
    const PdfManager = {
        MAX_WIDTH: 2400,      // 変換後の横幅上限
        JPEG_QUALITY: 0.9,


        async importPdf(file) {
            const quizBook = AppState.getCurrentQuizBook();
            if (!quizBook) {
                UIManager.switchToMode('quizBookSelection');
                return Utils.updateMessage('問題を追加する問題集が選択されていません。', 'error');
            }
            if (typeof pdfjsLib === 'undefined') {
                return Utils.updateMessage('PDFライブラリが読み込まれていません。index.htmlを確認してください。', 'error');
            }

            const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
            const input = prompt(
                `このPDFは全${pdf.numPages}ページです。取り込むページを指定してください（例: 1-5, 8, 10-12）`,
                `1-${Math.min(pdf.numPages, 20)}`
            );
            if (input === null) return Utils.updateMessage('取り込みをキャンセルしました。', 'info');

            const pages = this.parsePageRange(input, pdf.numPages);
            if (!pages.length) return Utils.updateMessage('ページ指定が正しくありません。', 'error');

            const baseTitle = file.name.replace(/\.[^/.]+$/, '');
            const newQuizzes = [];
            for (const num of pages) {
                Utils.updateMessage(`PDFを変換中... ${newQuizzes.length + 1}/${pages.length}ページ`, 'info');
                const { dataUrl, textLayer } = await this.renderPage(pdf, num);
                newQuizzes.push({
                    id: Utils.generateId(),
                    title: `${baseTitle} p.${num}`,
                    originalImageData: dataUrl,
                    textLayer: textLayer,
                    problemData: []
                });
            }

            quizBook.quizzes = [...(quizBook.quizzes || []), ...newQuizzes];
            await DBManager.updateQuizBook(quizBook);
            await DBManager.loadAllQuizBooks();
            UIManager.switchToMode('creation', { quizId: newQuizzes[0].id });
            Utils.updateMessage(`${newQuizzes.length}ページを取り込みました。`, 'success');
        },

        parsePageRange(str, max) {
            const set = new Set();
            String(str).split(',').forEach(part => {
                const m = part.trim().match(/^(\d+)\s*(?:-\s*(\d+))?$/);
                if (!m) return;
                const a = Math.max(1, parseInt(m[1], 10));
                const b = Math.min(max, m[2] ? parseInt(m[2], 10) : a);
                for (let i = a; i <= b; i++) set.add(i);
            });
            return [...set].sort((x, y) => x - y);
        },

        async renderPage(pdf, num) {
            const page = await pdf.getPage(num);
            const base = page.getViewport({ scale: 1 });
            const scale = Math.min(3, this.MAX_WIDTH / base.width);
            const viewport = page.getViewport({ scale });

            const canvas = document.createElement('canvas');
            canvas.width = Math.round(viewport.width);
            canvas.height = Math.round(viewport.height);
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';   // PDFの背景は透明なので白で塗る
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            await page.render({ canvasContext: ctx, viewport }).promise;

            const dataUrl = canvas.toDataURL('image/jpeg', this.JPEG_QUALITY);
            const textLayer = await this.extractTextLayer(page, viewport);
            page.cleanup();
            return { dataUrl, textLayer };
        },

        // 文字を相対座標(0〜1)で保存。mask.rect と同じ座標系なので直接比較できる
        async extractTextLayer(page, viewport) {
            try {
                const content = await page.getTextContent();
                const items = [];
                content.items.forEach(it => {
                    const s = (it.str || '').trim();
                    if (!s) return;
                    const t = pdfjsLib.Util.transform(viewport.transform, it.transform);
                    const h = Math.hypot(t[2], t[3]);
                    items.push({
                        s: s,
                        x: t[4] / viewport.width,
                        y: (t[5] - h) / viewport.height,   // t[5]はベースラインなので高さ分ずらす
                        w: (it.width * viewport.scale) / viewport.width,
                        h: h / viewport.height
                    });
                });
                return items;
            } catch (e) {
                console.warn('テキスト層の取得に失敗しました', e);
                return [];
            }
        },

        // マスク矩形の中に中心がある文字を拾って結合する
        textInRect(quiz, rect) {
            if (!quiz || !Array.isArray(quiz.textLayer) || !quiz.textLayer.length || !rect) return '';
            const hits = quiz.textLayer.filter(it => {
                const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
                return cx >= rect.x && cx <= rect.x + rect.width
                    && cy >= rect.y && cy <= rect.y + rect.height;
            });
            hits.sort((a, b) => (Math.abs(a.y - b.y) > 0.01 ? a.y - b.y : a.x - b.x));
            return hits.map(i => i.s).join('').replace(/\s+/g, ' ').trim();
        }
    };

    // --- 6. Canvas & Image Management (リファクタリング) ---
    const CanvasManager = {
        imageCache: new WeakMap(),

        async handleNewBookCreation() {
            const name = prompt("新しい問題集の名前を入力してください:", `問題集_${new Date().toLocaleDateString()}`);
            if (!name?.trim()) return Utils.updateMessage('問題集の作成がキャンセルされました。', 'info');
            
            try {
                const newBook = { id: Utils.generateId(), name: name.trim(), createdAt: Date.now(), quizzes: [] };
                await DBManager.addQuizBook(newBook);
                await DBManager.loadAllQuizBooks();
                AppState.currentQuizBookId = newBook.id;
                UIManager.switchToMode('problemManagement');
                Utils.updateMessage(`問題集「${newBook.name}」を作成しました。`, 'success');
            } catch (e) {
                Utils.updateMessage("問題集の作成に失敗しました。", "error");
            }
        },

                async handleImageUpload(file) {
            // ★追加：PDFなら専用処理へ
            if (file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name))) {
                Utils.updateMessage('PDFを読み込んでいます...', 'info');
                try {
                    return await PdfManager.importPdf(file);
                } catch (e) {
                    console.error('PDF import failed:', e);
                    return Utils.updateMessage('PDFの読み込みに失敗しました。', 'error');
                }
            }

            const quizBook = AppState.getCurrentQuizBook();
            if (!quizBook) {
                UIManager.switchToMode('quizBookSelection');
                return Utils.updateMessage('問題を追加する問題集が選択されていません。', 'error');
            }
            Utils.updateMessage('画像を処理しています...', 'info');
            try {
                // ★変更：巨大な画像は2400px幅に縮小してから保存（容量削減）
           const imageDataURL = await Utils.shrinkImage(file, 2400, 0.9);

                const quiz = { id: Utils.generateId(), title: file.name.replace(/\.[^/.]+$/, ""), originalImageData: imageDataURL, problemData: [] };
                quizBook.quizzes = [...(quizBook.quizzes || []), quiz];
                await DBManager.updateQuizBook(quizBook);
                await DBManager.loadAllQuizBooks();
                UIManager.switchToMode('creation', { quizId: quiz.id });
            } catch (e) {
                Utils.updateMessage('画像の処理に失敗しました。', 'error');
            }
        },


        loadImageFromQuizData(quizData, canvas) {
            if (!quizData?.originalImageData) {
                const ctx = canvas.getContext('2d');
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                return;
            }
            if (this.imageCache.has(quizData) && quizData.originalImage?.complete) {
                return this.setupCanvas(quizData.originalImage, canvas);
            }
            const image = new Image();
            image.onload = () => {
                quizData.originalImage = image;
                this.imageCache.set(quizData, image);
                this.setupCanvas(image, canvas);
            };
            image.src = quizData.originalImageData;
        },

              // ★追加：演習エリアで使える表示高さ（画面下端まで）を求める
        getAvailableExerciseHeight(container) {
            const top = container.getBoundingClientRect().top;
            return Math.max(200, Math.floor(window.innerHeight - top - 24));
        },

        setupCanvas(image, canvas) {
            if (!canvas) return;
            requestAnimationFrame(() => {
                const container = canvas.closest('#imageContainerWrapperCreation, #imageContainerWrapperExercise');
                if (!container || container.clientWidth === 0) return this.setupCanvas(image, canvas);

                const ar = image.width / image.height;
                let w = container.clientWidth - 32;
                let h = w / ar;

                // ★追加：演習モードは表示モードに応じてサイズを決める
                if (canvas.id === 'imageCanvasExercise') {
                    const mode = AppState.exerciseFitMode || 'contain';
                    const availW = w;
                    const availH = this.getAvailableExerciseHeight(container);
                    if (mode === 'height') {
                        h = availH;
                        w = h * ar;
                    } else if (mode === 'width') {
                        w = availW;
                        h = w / ar;
                    } else { // contain：画像全体が収まるように縦横どちらも収める
                        const s = Math.min(availW / image.width, availH / image.height);
                        w = image.width * s;
                        h = image.height * s;
                    }
                    w = Math.floor(w);
                    h = Math.floor(h);
                    container.style.overflow = 'auto'; // 縦いっぱい時に横スクロールできるように
                }

                // 元画像の解像度とズーム最大倍率を考慮して倍率を決める
                const dpr = window.devicePixelRatio || 1;
                const maxZoom = Number(DOM.zoomSlider?.max) || 3;
                const needScale = canvas.id === 'imageCanvasExercise' ? dpr * maxZoom : dpr * 2;
                const scale = Math.max(1.5, Math.min(needScale, image.naturalWidth / w));

                canvas.width = Math.floor(w * scale);
                canvas.height = Math.floor(h * scale);
                canvas.style.width = `${w}px`;
                canvas.style.height = `${h}px`;

                this.redrawCanvas(canvas);

                if (canvas.id === 'imageCanvasExercise') {
                    ExerciseModeManager.setupDropZones();
                    ExerciseModeManager.setupExerciseOptions();
                } else {
                    CreationModeManager.updateMaskList();
                    UIManager.updateCreationNavigation();
                }
            });
        },

        redrawCanvas(canvas) {
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            const currentQuiz = canvas.id === 'imageCanvas' ? AppState.getCurrentCreationQuiz() : AppState.getCurrentExerciseQuiz();
            if (!currentQuiz?.originalImage) return;

            let imageToDraw = currentQuiz.originalImage;
            if (canvas.id === 'imageCanvasExercise') {
                if (currentQuiz.grayscaleImage?.complete) {
                    imageToDraw = currentQuiz.grayscaleImage;
                } else if (!currentQuiz.grayscaleImage) {
                    this.createGrayscaleImage(currentQuiz);
                }
            }
            ctx.drawImage(imageToDraw, 0, 0, canvas.width, canvas.height);
            if (canvas.id === 'imageCanvas') DOM.dropZoneAndButtonContainerCreation.innerHTML = '';
            this.drawMasks(currentQuiz, canvas, ctx);
        },

        createGrayscaleImage(quiz) {
            const offscreenCanvas = document.createElement('canvas');
            const ctx = offscreenCanvas.getContext('2d');
            offscreenCanvas.width = quiz.originalImage.naturalWidth;
            offscreenCanvas.height = quiz.originalImage.naturalHeight;
            ctx.drawImage(quiz.originalImage, 0, 0);
            const imageData = ctx.getImageData(0, 0, offscreenCanvas.width, offscreenCanvas.height);
            const data = imageData.data;
            for (let i = 0; i < data.length; i += 4) {
                const avg = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
                data[i] = data[i + 1] = data[i + 2] = avg;
            }
            ctx.putImageData(imageData, 0, 0);
            const grayscaleImage = new Image();
            grayscaleImage.onload = () => this.redrawCanvas(DOM.imageCanvasExercise);
            grayscaleImage.src = offscreenCanvas.toDataURL();
            quiz.grayscaleImage = grayscaleImage;
        },

        drawMasks(quiz, canvas, ctx) {
            const displayRect = canvas.getBoundingClientRect();
            quiz.problemData?.forEach(mask => {
                if (canvas.id === 'imageCanvasExercise') {
                    const shouldShow = AppState.isFirstRound ? !mask.isAnswered : !mask.isAnswered && (mask.trainingPoints || 0) > 0;
                    if (!shouldShow) return;
                }
                const { x, y, width, height } = mask.rect;
                ctx.fillStyle = canvas.id === 'imageCanvasExercise' ? '#495057' : 'rgba(108, 117, 125, 0.75)';
                ctx.fillRect(x * canvas.width, y * canvas.height, width * canvas.width, height * canvas.height);

                if (canvas.id === 'imageCanvas') this.createDeleteButton(mask, displayRect);
            });
        },

        createDeleteButton(mask, displayRect) {
            const btn = document.createElement('button');
            btn.textContent = '×';
            btn.className = 'absolute bg-red-600 text-white font-bold rounded-full w-1.5 h-1.5 flex items-center justify-center text-[5px] leading-none opacity-60 hover:opacity-100 hover:scale-150 transition-transform pointer-events-auto';
            btn.style.left = `${mask.rect.x * displayRect.width + mask.rect.width * displayRect.width - 6}px`;
            btn.style.top = `${mask.rect.y * displayRect.height}px`;
            btn.dataset.action = "delete-mask-on-canvas";
            btn.dataset.maskId = mask.id;
            DOM.dropZoneAndButtonContainerCreation.appendChild(btn);
        }


    };
    
    // --- 7. Creation Mode Manager (リファクタリング) ---
    const CreationModeManager = {
        handleMouseDown(event) {
            if (AppState.currentMode !== 'creation') return;
            const rect = DOM.imageCanvas.getBoundingClientRect();
            AppState.isSelecting = true;
            AppState.currentSelectionRect = { x: event.clientX - rect.left, y: event.clientY - rect.top, width: 0, height: 0 };
            DOM.selectionRectangle.style.display = 'block';
        },
        handleMouseMove(event) {
            if (!AppState.isSelecting) return;
            const rect = DOM.imageCanvas.getBoundingClientRect();
            const selRect = AppState.currentSelectionRect;
            selRect.width = (event.clientX - rect.left) - selRect.x;
            selRect.height = (event.clientY - rect.top) - selRect.y;
            const norm = { x: selRect.width > 0 ? selRect.x : selRect.x + selRect.width, y: selRect.height > 0 ? selRect.y : selRect.y + selRect.height, width: Math.abs(selRect.width), height: Math.abs(selRect.height) };
            Object.assign(DOM.selectionRectangle.style, { left: `${norm.x}px`, top: `${norm.y}px`, width: `${norm.width}px`, height: `${norm.height}px` });
        },
                handleMouseUp() {
            if (!AppState.isSelecting) return;
            AppState.isSelecting = false;
            const rect = AppState.currentSelectionRect;
            const isDrag = rect && Math.abs(rect.width) > 5 && Math.abs(rect.height) > 5;

            if (isDrag) {
                this.createMask();
            } else if (AppState.stampMode && AppState.lastMaskSize && rect) {
                // ★追加：クリックした点を左上として、直前と同じ大きさのマスクを置く
                const cr = DOM.imageCanvas.getBoundingClientRect();
                AppState.currentSelectionRect = {
                    x: rect.x,
                    y: rect.y,
                    width: AppState.lastMaskSize.width * cr.width,
                    height: AppState.lastMaskSize.height * cr.height
                };
                this.createMask();
            }
            DOM.selectionRectangle.style.display = 'none';
            AppState.currentSelectionRect = null;
        },

                async createMask() {
            const rect = AppState.currentSelectionRect;   // ★promptより前に必ず捕まえる
           AppState.suppressNextCanvasClick = true;   // 作成直後のclickで一括設定が走るのを防ぐ

            setTimeout(() => { AppState.suppressNextCanvasClick = false; }, 400); // ★フラグが残り続けないように自動解除


            if (!rect) return;

            const quizBook = AppState.getCurrentQuizBook();
            let quiz = AppState.getCurrentCreationQuiz();
            if (!quiz?.originalImage) return;

            const canvasRect = DOM.imageCanvas.getBoundingClientRect();
            const relRect = {
                x: (rect.width > 0 ? rect.x : rect.x + rect.width) / canvasRect.width,
                y: (rect.height > 0 ? rect.y : rect.y + rect.height) / canvasRect.height,
                width: Math.abs(rect.width) / canvasRect.width,
                height: Math.abs(rect.height) / canvasRect.height
            };

            // ★追加：PDF由来ならその範囲の文字を初期値として提示する
            const suggested = PdfManager.textInRect(quiz, relRect);

            const maskText = prompt("このマスク部分のテキストを入力してください：", suggested);
            if (maskText === null) return;
            AppState.lastMaskSize = { width: relRect.width, height: relRect.height }; // ★追加
            const maskData = { id: Utils.generateId(), rect: relRect, text: maskText.trim(), imageData: this.extractMaskImage(quiz.originalImage, relRect), importance: '☆', groupId: null, history: [], trainingPoints: 0 };

            quiz.problemData = [...(quiz.problemData || []), maskData];
            await DBManager.updateQuizBook(quizBook);
            CanvasManager.redrawCanvas(DOM.imageCanvas);
            this.updateMaskList();
            UIManager.updateCreationNavigation();
        },

                extractMaskImage(originalImage, relRect) {
            const canvas = document.createElement('canvas');
            const srcW = relRect.width * originalImage.width;
            const srcH = relRect.height * originalImage.height;
            const MAX_W = 400;                            // ★選択肢表示用なのでこれで十分
            const scale = Math.min(1, MAX_W / srcW);      // 小さい画像は拡大しない
            canvas.width = Math.max(1, Math.round(srcW * scale));
            canvas.height = Math.max(1, Math.round(srcH * scale));
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(originalImage,
                relRect.x * originalImage.width, relRect.y * originalImage.height, srcW, srcH,
                0, 0, canvas.width, canvas.height);
            return canvas.toDataURL('image/jpeg', 0.85);
        },

        async deleteMask(maskId) {
            if (!confirm('このマスクを削除しますか？')) return;
            const quizBook = AppState.getCurrentQuizBook();
            let quiz = AppState.getCurrentCreationQuiz();
            if (quiz?.problemData) {
                quiz.problemData = quiz.problemData.filter(m => m.id !== maskId);
                await DBManager.updateQuizBook(quizBook);
                CanvasManager.redrawCanvas(DOM.imageCanvas);
                this.updateMaskList();
                UIManager.updateCreationNavigation();
                Utils.updateMessage('マスクを削除しました。', 'success');
            }
        },
                getLiveCreationTarget() {
            const book = AppState.masterQuizList.find(b => b.id === AppState.currentQuizBookId);
            const quiz = book?.quizzes?.[AppState.currentProblemIndexCreation];
            return { book, quiz };
        },

        async editMaskText(maskId) {
            const { book, quiz } = this.getLiveCreationTarget();
            const mask = quiz?.problemData?.find(m => m.id === maskId);
            if (!book || !mask) return Utils.updateMessage('対象のマスクが見つかりませんでした。', 'error');

            const newText = prompt('このマスクの正解テキストを入力してください：', mask.text || '');
            if (newText === null) return;

            mask.text = newText.trim();
            await DBManager.updateQuizBook(book);
            this.updateMaskList();
            Utils.updateMessage('正解テキストを更新しました。', 'success');
        },
                // 現在編集中の問題に限定してグループを全解除
        async clearAllGroupsInCurrentQuiz() {
            const { book, quiz } = this.getLiveCreationTarget();
            if (!book || !quiz?.problemData?.length) {
                return Utils.updateMessage('対象の問題が見つかりません。', 'error');
            }
            const targets = quiz.problemData.filter(m => m.groupId);
            if (targets.length === 0) {
                return Utils.updateMessage('この問題にはグループ設定されたマスクがありません。', 'info');
            }
            if (!confirm(`「${quiz.title}」のマスク ${targets.length} 件のグループ設定を解除します。よろしいですか？`)) return;

            targets.forEach(m => { m.groupId = null; });
            await DBManager.updateQuizBook(book);
            UIManager.clearBulkSelectModes();
            CanvasManager.redrawCanvas(DOM.imageCanvas);
            this.updateMaskList();
            Utils.updateMessage(`${targets.length} 件のグループ設定を解除しました。`, 'success');
        },

        // 現在編集中の問題に限定して重要度を初期値（☆）に戻す
        async clearAllImportanceInCurrentQuiz() {
            const { book, quiz } = this.getLiveCreationTarget();
            if (!book || !quiz?.problemData?.length) {
                return Utils.updateMessage('対象の問題が見つかりません。', 'error');
            }
            const targets = quiz.problemData.filter(m => (m.importance || '☆') !== '☆');
            if (targets.length === 0) {
                return Utils.updateMessage('この問題には☆以外の重要度が設定されたマスクがありません。', 'info');
            }
            if (!confirm(`「${quiz.title}」のマスク ${targets.length} 件の重要度を「☆」に戻します。よろしいですか？`)) return;

            targets.forEach(m => { m.importance = '☆'; });
            await DBManager.updateQuizBook(book);
            UIManager.clearBulkSelectModes();
            this.updateMaskList();
            Utils.updateMessage(`${targets.length} 件の重要度を「☆」に戻しました。`, 'success');
        },



        updateMaskList() {
            const container = DOM.optionsContainerCreation;
            const quiz = AppState.getCurrentCreationQuiz();
            if (!container) return;
            container.innerHTML = '';
            if (!quiz?.problemData?.length) {
                container.innerHTML = '<p class="text-gray-500 text-sm text-center">ここにマスキングした部分が表示されます</p>';
                return;
            }
            const fragment = document.createDocumentFragment();
            quiz.problemData.forEach(mask => fragment.appendChild(this.createMaskElement(mask)));
            container.appendChild(fragment);
        },
        createMaskElement(mask) {
            const el = document.createElement('div');
            el.className = 'option-item-wrapper bg-blue-50 p-2 rounded border border-blue-200 relative cursor-pointer hover:bg-blue-100 transition-colors flex flex-col items-center w-full';
            el.dataset.maskId = mask.id;
            const historyStr = (mask.history || []).join('') || 'なし';
            const points = mask.trainingPoints || 0;
            const pointsColor = points > 0 ? 'bg-red-200 text-red-800' : 'bg-green-200 text-green-800';
            el.innerHTML = `<div class="flex items-center w-full"><div class="flex-shrink-0"><img src="${mask.imageData}" alt="マスク画像" class="mb-2 border border-gray-400 rounded max-w-[100px] max-h-[50px] object-contain"></div><div class="flex-grow text-left ml-4"><div class="font-semibold text-sm break-all">${mask.text || '(テキストなし)'}</div><div class="text-xs text-gray-600">重要度: <span class="font-bold text-yellow-600">${mask.importance || '☆'}</span></div>${mask.groupId ? `<div class="text-xs text-green-700 font-semibold">グループ: ${mask.groupId}</div>` : ''}<div class="text-xs text-gray-500 mt-1">履歴: <span class="history-display">${historyStr}</span></div><div class="text-xs text-gray-500 mt-1">鍛錬P: <span class="training-points-display ${pointsColor}">${points}</span></div></div></div><button class="absolute top-1 right-7 px-1.5 h-5 bg-blue-500 text-white rounded text-xs flex items-center justify-center hover:bg-blue-600" data-action="edit-mask-text" data-mask-id="${mask.id}">編集</button>
<button class="delete-mask-btn absolute top-1 right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600" data-action="delete-mask" data-mask-id="${mask.id}">×</button>`;
            return el;
        }
    };

    // --- 8. Exercise Mode Manager (スマホモード対応 & 大幅リファクタリング) ---
    const ExerciseModeManager = {
                startExerciseMode(problemList) {
            AppState.exerciseMasterProblems = JSON.parse(JSON.stringify(problemList)); // 絞り込み前の原本を保持

            AppState.originalExerciseProblems = JSON.parse(JSON.stringify(problemList));
            AppState.exerciseData = JSON.parse(JSON.stringify(problemList));
            AppState.currentProblemIndexExercise = 0;
            AppState.exerciseRound = 1;
            AppState.isFirstRound = true;
            AppState.exerciseFitMode = 'contain'; // ★標準は画像全体表示
            if (DOM.zoomSlider) {
                DOM.zoomSlider.value = 1;
                DOM.zoomValue.textContent = '1.0x';
                DOM.imageDisplayAreaExercise.style.transform = 'scale(1)';
            }
            this.ensureFitButtons();
            this.setFitMode('contain', false); // ★描画は下の loadExerciseProblem に任せる
            this.loadExerciseProblem();
        },

        // ★追加：マスクを読み順（上の行から、行内は左から右）に並べる
        sortMasksInReadingOrder(masks) {
            const rows = [];
            [...masks].sort((a, b) => a.rect.y - b.rect.y).forEach(m => {
                const cy = m.rect.y + m.rect.height / 2;
                const row = rows.find(r => cy >= r.top && cy <= r.bottom);
                if (row) {
                    row.items.push(m);
                    row.top = Math.min(row.top, m.rect.y);
                    row.bottom = Math.max(row.bottom, m.rect.y + m.rect.height);
                } else {
                    rows.push({ top: m.rect.y, bottom: m.rect.y + m.rect.height, items: [m] });
                }
            });
            rows.forEach(r => r.items.sort((a, b) => a.rect.x - b.rect.x));
            return rows.flatMap(r => r.items);
        },

        // ★追加：問題を開いたら一番上のマスクを解答状態にする（キーボード/音声で即入力できるように）
        focusFirstMask(attempt = 0) {
            if (AppState.isMobileMode) return;
            const quiz = AppState.getCurrentExerciseQuiz();
            const active = this.sortMasksInReadingOrder(this.getActiveMasks(quiz));
            if (active.length === 0) return;
            const zone = DOM.dropZoneContainerExercise?.querySelector(`[data-mask-id="${active[0].id}"]`);
            if (zone) return this.showTextInputForMask(active[0].id, zone);
            // 画像読み込み・ドロップゾーン生成が終わるまで少し待って再挑戦
            if (attempt < 25) setTimeout(() => this.focusFirstMask(attempt + 1), 100);
        },

        loadExerciseProblem() {
            AppState.shouldShuffleOptions = true; 
            AppState.selectedMaskForMobile = null;
            const currentQuiz = AppState.getCurrentExerciseQuiz();
            if (!currentQuiz) return UIManager.switchToMode('problemManagement');
            
            UIManager.updateExerciseNavigation();
            
            const remainingTrainingPoints = currentQuiz.problemData.some(mask => (mask.trainingPoints || 0) > 0);
                       if (!AppState.isFirstRound && !remainingTrainingPoints) {
                return this.moveToNextProblemOrEndRound(); // この問題は鍛錬不要なので次へ
            }

            
          　currentQuiz.problemData = this.sortMasksInReadingOrder(currentQuiz.problemData); // ★読み順に並べ替え
                        currentQuiz.problemData.forEach(mask => { mask.isAnswered = false; mask.missedThisRound = false; });
            currentQuiz.redoRound = 1;


            this.initializeTextInputContainer(); // PCモード用のUIを初期化
            CanvasManager.loadImageFromQuizData(currentQuiz, DOM.imageCanvasExercise);
            this.updateTrainingPointsDisplay();
                  this.focusFirstMask(); // ★一番上のマスクを自動選択
        },

                // ★追加：ズームスライダーの隣に表示モードボタンを生成
        ensureFitButtons() {
            if (document.getElementById('fitModeButtons')) return this.highlightFitButtons();
            const anchor = DOM.zoomSlider?.parentElement || DOM.imageContainerWrapperExercise;
            if (!anchor) return;
            const box = document.createElement('div');
            box.id = 'fitModeButtons';
            box.className = 'inline-flex flex-wrap gap-1 ml-2';
            box.innerHTML = `<button type="button" data-fit="contain" class="fit-btn px-2 py-1 text-xs rounded border border-gray-300 bg-white hover:bg-gray-100">🖼️ 全体</button>`
                + `<button type="button" data-fit="height" class="fit-btn px-2 py-1 text-xs rounded border border-gray-300 bg-white hover:bg-gray-100">↕️ 縦いっぱい</button>`
                + `<button type="button" data-fit="width" class="fit-btn px-2 py-1 text-xs rounded border border-gray-300 bg-white hover:bg-gray-100">↔️ 横いっぱい</button>`;
            anchor.appendChild(box);
            box.addEventListener('click', e => {
                const btn = e.target.closest('.fit-btn');
                if (btn) ExerciseModeManager.setFitMode(btn.dataset.fit);
            });
            this.highlightFitButtons();
        },

        highlightFitButtons() {
            const mode = AppState.exerciseFitMode || 'contain';
            document.querySelectorAll('#fitModeButtons .fit-btn').forEach(b => {
                const on = b.dataset.fit === mode;
                b.classList.toggle('bg-blue-600', on);
                b.classList.toggle('text-white', on);
                b.classList.toggle('bg-white', !on);
            });
        },

        setFitMode(mode, redraw = true) {
            AppState.exerciseFitMode = mode || 'contain';
            this.highlightFitButtons();
            if (DOM.zoomSlider) {
                DOM.zoomSlider.value = 1;
                DOM.zoomValue.textContent = '1.0x';
                DOM.imageDisplayAreaExercise.style.transform = 'scale(1)';
            }
            if (!redraw) return;
            const quiz = AppState.getCurrentExerciseQuiz();
            if (!quiz) return;
            if (quiz.originalImage?.complete) CanvasManager.setupCanvas(quiz.originalImage, DOM.imageCanvasExercise);
            else CanvasManager.loadImageFromQuizData(quiz, DOM.imageCanvasExercise);
        },

                               // ★解答中のマスクを、画像表示エリアの内部スクロールだけで画面内に入れる
        scrollAnsweringAreaIntoView(dropZoneElement) {
            const zone = dropZoneElement
                || DOM.dropZoneContainerExercise?.querySelector(`[data-mask-id="${AppState.currentAnsweringMaskId}"]`);
            const wrapper = DOM.imageContainerWrapperExercise;
            if (!zone || !wrapper) return;

            requestAnimationFrame(() => {
                const maxX = wrapper.scrollWidth - wrapper.clientWidth;
                const maxY = wrapper.scrollHeight - wrapper.clientHeight;
                if (maxX <= 0 && maxY <= 0) return; // スクロールの余地がなければ何もしない

                const z = zone.getBoundingClientRect();
                const w = wrapper.getBoundingClientRect();
                const m = 32; // 枠からこれだけ内側に入るように寄せる

                // はみ出している方向にだけ、必要な分だけ動かす
                let dx = 0, dy = 0;
                if (z.left < w.left + m) dx = z.left - (w.left + m);
                else if (z.right > w.right - m) dx = Math.min(z.right - (w.right - m), z.left - (w.left + m));
                if (z.top < w.top + m) dy = z.top - (w.top + m);
                else if (z.bottom > w.bottom - m) dy = Math.min(z.bottom - (w.bottom - m), z.top - (w.top + m));
                if (!dx && !dy) return;

                wrapper.scrollTo({
                    left: Math.max(0, Math.min(maxX, wrapper.scrollLeft + dx)),
                    top: Math.max(0, Math.min(maxY, wrapper.scrollTop + dy)),
                    behavior: 'smooth'
                });
            });
        },



     

        initializeTextInputContainer() {
            if (!DOM.exerciseTextInputContainer || AppState.isMobileMode) {
                if (DOM.exerciseTextInputContainer) DOM.exerciseTextInputContainer.innerHTML = '';
                return;
            }
            DOM.exerciseTextInputContainer.innerHTML = `<div class="bg-gray-50 p-3 rounded-md border border-gray-200 mb-3" style="min-height: 110px;"><div class="w-full px-3 py-2 border border-gray-300 rounded-md bg-white text-gray-500" style="height: 40px; display: flex; align-items: center;">💡 マスクをクリックしてテキスト入力</div></div>`;
        },

        setupExerciseOptions() {
            const container = DOM.optionsContainerExercise;
            const quiz = AppState.getCurrentExerciseQuiz();
            if (!container || !quiz?.problemData) return;
            container.innerHTML = '';
            
            let unansweredMasks = AppState.isFirstRound ? quiz.problemData.filter(m => !m.isAnswered) : quiz.problemData.filter(m => !m.isAnswered && (m.trainingPoints || 0) > 0);
            if (unansweredMasks.length === 0) return this.handleNoOptionsAvailable(quiz);
            
            this.shuffleAndDisplayOptions(unansweredMasks, container);
        },

                handleNoOptionsAvailable(quiz) {
            DOM.optionsContainerExercise.innerHTML = '<p class="text-blue-600 text-center font-semibold p-4">🔄 判定中...</p>';
        },

        
        shuffleAndDisplayOptions(unansweredMasks, container) {
            if (AppState.shouldShuffleOptions) {
                unansweredMasks.sort(() => Math.random() - 0.5);
                AppState.currentOptionOrder = unansweredMasks.map(mask => mask.id);
                AppState.shouldShuffleOptions = false;
            } else {
                unansweredMasks.sort((a, b) => AppState.currentOptionOrder.indexOf(a.id) - AppState.currentOptionOrder.indexOf(b.id));
            }
            const fragment = document.createDocumentFragment();
            unansweredMasks.forEach(mask => fragment.appendChild(this.createOptionElement(mask)));
            container.appendChild(fragment);
        },

        createOptionElement(mask) {
            const el = document.createElement('div');
            el.className = 'option-item-wrapper bg-white border border-gray-300 p-2 rounded shadow-sm flex flex-col items-center';
            el.draggable = !AppState.isMobileMode;
            el.dataset.maskId = mask.id;
            el.innerHTML = `<img src="${mask.imageData}" alt="選択肢画像" class="border border-gray-400 rounded object-contain pointer-events-none">`;

            if (AppState.isMobileMode) {
                el.addEventListener('click', () => this.handleOptionTap(mask.id, el));
            } else {
                el.addEventListener('dragstart', e => {
               e.dataTransfer.setData('text/plain', 'maskid:' + mask.id);

                    e.dataTransfer.effectAllowed = 'move';
                    el.style.opacity = '0.5';
                });
                el.addEventListener('dragend', () => el.style.opacity = '1');
            }
            return el;
        },

        setupDropZones() {
            const container = DOM.dropZoneContainerExercise;
            const quiz = AppState.getCurrentExerciseQuiz();
            const canvas = DOM.imageCanvasExercise;
            if (!container || !quiz?.problemData || !canvas?.width) return;
            
            container.innerHTML = '';
            const fragment = document.createDocumentFragment();
                        // ★変更：getBoundingClientRectはズーム(transform)の影響を受けるためoffsetを使う
            const canvasRect = { width: canvas.offsetWidth, height: canvas.offsetHeight };

            
            quiz.problemData.forEach(mask => {
                const shouldCreate = AppState.isFirstRound ? !mask.isAnswered : !mask.isAnswered && (mask.trainingPoints || 0) > 0;
                if (shouldCreate) fragment.appendChild(this.createDropZone(mask, canvasRect));
            });
            container.appendChild(fragment);
            this.checkClearCondition(fragment.children.length, quiz);
        },

        createDropZone(mask, canvasRect) {
            const el = document.createElement('div');
            el.className = 'drop-zone-element';
            el.dataset.maskId = mask.id;
            Object.assign(el.style, { left: `${mask.rect.x * canvasRect.width}px`, top: `${mask.rect.y * canvasRect.height}px`, width: `${mask.rect.width * canvasRect.width}px`, height: `${mask.rect.height * canvasRect.height}px` });
            
            if (AppState.isMobileMode) {
                el.addEventListener('click', () => this.handleMaskTap(mask.id, el));
            } else {
                el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('drag-over'); });
                el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
                el.addEventListener('drop', e => { e.preventDefault(); el.classList.remove('drag-over'); this.checkAnswer(e.dataTransfer.getData('text/plain'), mask.id); });
                el.addEventListener('click', e => { e.stopPropagation(); this.showTextInputForMask(mask.id, el); });
            }
            return el;
        },

                checkClearCondition(dropZoneCount, quiz) {
            // 進行判定は updateScreenAfterAnswer / moveToNextProblemOrEndRound に一本化
        },


        updateTrainingPointsDisplay() {
            const quiz = AppState.getCurrentExerciseQuiz();
            if (!quiz?.problemData) return;
            const totalPoints = quiz.problemData.reduce((sum, m) => sum + (m.trainingPoints || 0), 0);
            const remainingMasks = quiz.problemData.filter(m => (m.trainingPoints || 0) > 0).length;
            
            if (AppState.isFirstRound) {
                Utils.updateMessage(`問題 ${AppState.currentProblemIndexExercise + 1}/${AppState.exerciseData.length} - 一巡目`, 'info');
            } else if (totalPoints > 0) {
                Utils.updateMessage(`🔥 鍛錬モード - 鍛錬ポイント: ${totalPoints}点 (${remainingMasks}問が要復習)`, 'info');
            } else {
                Utils.updateMessage(`✅ この問題をクリアしました！`, 'success');
            }
        },

        // --- スマホモード用タップ処理 ---
        handleMaskTap(maskId, element) {
            if (AppState.selectedMaskForMobile === maskId) { // 同じマスクを再度タップで選択解除
                AppState.selectedMaskForMobile = null;
                element.classList.remove('mobile-selected');
      　　　　　 this.scrollAnsweringAreaIntoView(element);

                Utils.updateMessage('解答するマスクをタップしてください', 'info');
                return;
            }
            AppState.selectedMaskForMobile = maskId;
            document.querySelectorAll('.drop-zone-element.mobile-selected').forEach(el => el.classList.remove('mobile-selected'));
            element.classList.add('mobile-selected');
                        this.scrollAnsweringAreaIntoView(element);

            Utils.updateMessage('対応する選択肢をタップしてください', 'info');
        },
        handleOptionTap(optionMaskId, element) {
            if (!AppState.selectedMaskForMobile) {
                Utils.updateMessage('先に解答したいマスク（画像上の四角）をタップしてください', 'error');
                return;
            }
          this.checkAnswer('maskid:' + optionMaskId, AppState.selectedMaskForMobile);

            AppState.selectedMaskForMobile = null;
            const selectedZone = DOM.dropZoneContainerExercise.querySelector('.mobile-selected');
            if(selectedZone) selectedZone.classList.remove('mobile-selected');
        },
        
        showTextInputForMask(maskId, dropZoneElement) {
            if (AppState.isMobileMode) return;
            AppState.currentAnsweringMaskId = maskId;
            const inputContainer = this.createTextInputContainer();
            DOM.exerciseTextInputContainer.innerHTML = '';
            DOM.exerciseTextInputContainer.appendChild(inputContainer);
            this.setupTextInputEvents(inputContainer, maskId);
            this.highlightMask(dropZoneElement);
            setTimeout(() => inputContainer.querySelector('input')?.focus({ preventScroll: true }), 100);
            this.scrollAnsweringAreaIntoView(dropZoneElement);



        },

        createTextInputContainer() {
            const container = document.createElement('div');
            container.className = 'bg-blue-50 p-3 rounded-md border-2 border-blue-300 mb-3';
            container.innerHTML = `<input type="text" id="mask-text-input" class="w-full px-3 py-2 border border-gray-300 rounded-md" placeholder="テキストで解答..."><div class="flex justify-between items-center mt-2"><div class="flex space-x-2"><button id="submit-text-answer" class="px-4 py-2 bg-blue-500 text-white rounded-md text-sm">解答</button><button id="cancel-text-answer" class="px-4 py-2 bg-gray-500 text-white rounded-md text-sm">キャンセル</button></div><button id="mic-start-btn" class="mic-button px-3 py-2 bg-green-500 text-white rounded-md text-sm" title="音声入力">🎤</button></div>`;
            return container;
        },

        setupTextInputEvents(container, maskId) {
            const input = container.querySelector('input');
            container.querySelector('#submit-text-answer').addEventListener('click', () => this.checkAnswer(input.value, maskId));
            container.querySelector('#cancel-text-answer').addEventListener('click', () => this.cancelTextInput());
            container.querySelector('#mic-start-btn').addEventListener('click', () => SpeechManager.toggle());
            input.addEventListener('keypress', e => { if (e.key === 'Enter') this.checkAnswer(input.value, maskId); });

            // ★追加：Tab / Shift+Tab、Ctrl+→ / Ctrl+← でマスク間を移動
            input.addEventListener('keydown', e => {
                if (e.isComposing || e.keyCode === 229) return; // IME変換中は無視
                let direction = 0;
                if (e.key === 'Tab') direction = e.shiftKey ? -1 : 1;
                else if (e.ctrlKey && e.key === 'ArrowRight') direction = 1;
                else if (e.ctrlKey && e.key === 'ArrowLeft') direction = -1;
                if (direction === 0) return;
                e.preventDefault();
                this.moveToAdjacentMask(direction);
            });

            SpeechManager.updateMicButtonUI();
        },

        // ★追加：現在解答中のマスクから前後のマスクへ移動する
                moveToAdjacentMask(direction) {
            if (AppState.isMobileMode || !AppState.currentAnsweringMaskId) return;
            const quiz = AppState.getCurrentExerciseQuiz();
            const ordered = this.sortMasksInReadingOrder(this.getActiveMasks(quiz));
            if (ordered.length <= 1) return;
            const i = ordered.findIndex(m => m.id === AppState.currentAnsweringMaskId);
            if (i === -1) return;
            const next = ordered[(i + direction + ordered.length) % ordered.length];
            const zone = DOM.dropZoneContainerExercise.querySelector(`[data-mask-id="${next.id}"]`);
            if (zone) this.showTextInputForMask(next.id, zone);
        },



        cancelTextInput() {
            document.querySelector('.active-mask-highlight')?.classList.remove('active-mask-highlight');
            AppState.currentAnsweringMaskId = null;
            this.initializeTextInputContainer();
        },

        highlightMask(dropZoneElement) {
            document.querySelector('.active-mask-highlight')?.classList.remove('active-mask-highlight');
            dropZoneElement.classList.add('active-mask-highlight');
        },

                        async checkAnswer(answer, targetMaskId) {
            const quiz = AppState.getCurrentExerciseQuiz();
            if (!quiz) return;
            const targetMask = quiz.problemData.find(m => m.id === targetMaskId);
            if (!targetMask || targetMask.isAnswered) return;

            const quizBook = AppState.masterQuizList.find(b => b.quizzes?.some(q => q.id === quiz.id));
            const quizInDb = quizBook?.quizzes.find(q => q.id === quiz.id);

            const { answerMask, isCorrect, byDrag } = this.evaluateAnswer(answer, targetMask, quiz);

            if (!isCorrect && !byDrag && this.isPassWord(answer)) {
                return this.processPass(targetMask, quizBook, quizInDb, quiz);
            }

            await this.processAnswerResult(isCorrect, targetMask, answerMask, quizBook, quizInDb);
                        if (!isCorrect && !byDrag) this.offerAliasRegistration(answer, targetMask, quizBook, quizInDb); // ★別解の登録を提案


            setTimeout(() => this.updateScreenAfterAnswer(quiz, isCorrect, targetMask.id), 300);
        },


        // ★追加：パスとみなす言葉（ここに単語を足せば増やせます）
                PASS_WORDS: [
            'パス', 'ぱす', 'バス', 'pass', 'スキップ', 'skip', 'とばす', '飛ばす',
            'わからない', 'わかりません', 'わかんない', 'わからん',
            '分からない', '分かりません', '判らない',
            'しらない', 'しりません', '知らない', '知りません',
            'こうさん', '降参', 'ギブアップ', 'ぎぶあっぷ', 'giveup',
            'つぎ', '次', 'ヒント', 'むり', '無理', 'おてあげ', 'お手上げ'
        ],

               isPassWord(answer) {
            const a = Utils.normalizeForCompare(answer);
            if (!a || a.length > 8) return false;
            return this.PASS_WORDS.some(w => {
                const b = Utils.normalizeForCompare(w);
                if (!b) return false;
                if (a === b) return true;
                return b.length >= 4 && a.length >= 4 && Utils.levenshtein(a, b) <= 1;
            });
        },



        // ★追加：パス時の処理（不正解と同じ扱い＋答えの表示）
        async processPass(targetMask, quizBook, quizInDb, quiz) {
                        const dbMask = quizInDb?.problemData.find(m => m.id === targetMask.id);
            const firstMiss = !targetMask.missedThisRound;
            if (dbMask && firstMiss) {
                dbMask.history = [...(dbMask.history || []), '×'].slice(-10);
                dbMask.trainingPoints = (dbMask.trainingPoints || 0) + 2;
            }
            targetMask.missedThisRound = true;

            targetMask.trainingPoints = dbMask?.trainingPoints || 0;
            targetMask.isAnswered = true;

            UIManager.showAnimation(targetMask.id, 'incorrect');
            this.showPassReveal(targetMask);
            Utils.updateMessage(`⏭️ パス → 正解は「${targetMask.text || '(テキストなし)'}」 鍛錬ポイント+2 (現在${targetMask.trainingPoints})`, 'error');

            if (quizBook) await DBManager.updateQuizBook(quizBook);
            this.clearTextInput();
           　setTimeout(() => this.updateScreenAfterAnswer(quiz, true), 1500);

        },

        // ★追加：マスクの位置に答えのラベルを一定時間表示する
                // ★追加：不正解だった入力を「別の正解」として登録できるボタンを出す
        offerAliasRegistration(userAnswer, targetMask, quizBook, quizInDb) {
                        console.log('[alias] 呼ばれた:', JSON.stringify(userAnswer));


            const raw = String(userAnswer || '').trim();
            if (!raw || raw.startsWith('maskid:') || raw.length > 40) return;
            document.getElementById('aliasToast')?.remove();

            const box = document.createElement('div');
            box.id = 'aliasToast';
            box.style.cssText = 'position:fixed; right:16px; bottom:16px; z-index:9998; max-width:340px; background:#fff; border:2px solid #f59e0b; border-radius:10px; box-shadow:0 6px 20px rgba(0,0,0,.25); padding:10px 12px; font-size:13px;';
            box.innerHTML = `<div style="margin-bottom:8px;">正解「<b>${targetMask.text || '(なし)'}</b>」<br>あなたの入力「<b>${raw}</b>」</div>`
                + `<div style="display:flex; gap:6px;">`
                + `<button id="aliasAddBtn" style="flex:1; padding:6px; background:#16a34a; color:#fff; border-radius:6px;">これも正解に追加</button>`
                + `<button id="aliasCloseBtn" style="padding:6px 10px; background:#9ca3af; color:#fff; border-radius:6px;">閉じる</button>`
                + `</div>`;
            document.body.appendChild(box);

            const close = () => box.remove();
            box.querySelector('#aliasCloseBtn').addEventListener('click', close);
            box.querySelector('#aliasAddBtn').addEventListener('click', async () => {
                const dbMask = quizInDb?.problemData.find(m => m.id === targetMask.id);
                if (dbMask) {
                    dbMask.aliases = [...new Set([...(dbMask.aliases || []), raw])];
                    dbMask.trainingPoints = Math.max(0, (dbMask.trainingPoints || 0) - 2); // 誤判定分の加点を戻す
                    const h = [...(dbMask.history || [])];
                    if (h[h.length - 1] === '×') h[h.length - 1] = '〇';
                    dbMask.history = h;
                }
                targetMask.aliases = [...new Set([...(targetMask.aliases || []), raw])];
                targetMask.trainingPoints = dbMask?.trainingPoints ?? targetMask.trainingPoints;
                if (quizBook) await DBManager.updateQuizBook(quizBook);
                Utils.updateMessage(`「${raw}」も正解に登録しました。もう一度同じように答えると正解になります。`, 'success');
                close();
            });

            setTimeout(() => box.remove(), 20000);
        },

        showPassReveal(mask) {
            const canvas = DOM.imageCanvasExercise;
            const area = DOM.imageDisplayAreaExercise;
            if (!canvas || !area) return;
            const w = canvas.clientWidth;
            const h = canvas.clientHeight;
            const label = document.createElement('div');
            label.textContent = `答: ${mask.text || '(テキストなし)'}`;
            Object.assign(label.style, {
                position: 'absolute',
                left: `${mask.rect.x * w}px`,
                top: `${mask.rect.y * h}px`,
                minWidth: `${mask.rect.width * w}px`,
                padding: '2px 6px',
                background: 'rgba(220, 38, 38, 0.92)',
                color: '#ffffff',
                fontWeight: 'bold',
                fontSize: '14px',
                borderRadius: '4px',
                whiteSpace: 'nowrap',
                pointerEvents: 'none',
                zIndex: '40'
            });
            area.appendChild(label);
            setTimeout(() => label.remove(), 4000);
        },


                        evaluateAnswer(answer, targetMask, quiz) {
            const raw = String(answer || '').trim();

            // ① ドラッグ＆ドロップ／タップ：渡ってくるのは選択肢のマスクID
                        // ① 選択肢の移動（ドラッグ／タップ）：ID照合のみ。文字比較には絶対に流さない
            if (raw.startsWith('maskid:')) {
                const id = raw.slice(7);
                const byId = quiz.problemData.find(m => m.id === id) || null;
                const sameMask = !!byId && byId.id === targetMask.id;
                const tGroup = targetMask.groupId ?? null;
                const aGroup = byId?.groupId ?? null;
                const sameGroup = tGroup !== null && aGroup !== null && String(tGroup) === String(aGroup);
                console.log('[判定/ドラッグ]', { 落とした: byId?.text, 落とした側group: aGroup, 穴: targetMask.text, 穴のgroup: tGroup, 正解: sameMask || sameGroup });
                return { answerMask: byId, isCorrect: sameMask || sameGroup, byDrag: true };
            }


            // ② テキスト／音声：あいまい一致
            const TOLERANCE = 0.25;
            const hit = (mask) => Utils.looseMatch(raw, [mask.text, ...(mask.aliases || [])].join('／'), TOLERANCE);


            if (hit(targetMask)) return { answerMask: targetMask, isCorrect: true, byDrag: false };

            if (targetMask.groupId) {
                            const groupMask = quiz.problemData.find(m => !m.isAnswered && String(m.groupId ?? '') === String(targetMask.groupId) && hit(m));

                if (groupMask) return { answerMask: groupMask, isCorrect: true, byDrag: false };
            }
            const otherMask = quiz.problemData.find(m => hit(m));
            return { answerMask: otherMask || null, isCorrect: false, byDrag: false };
        },



                               async processAnswerResult(isCorrect, targetMask, answerMask, quizBook, quizInDb) {
            const scored = (isCorrect && answerMask && !answerMask.isAnswered) ? answerMask : targetMask;
            const dbMask = quizInDb?.problemData.find(m => m.id === scored.id);

            if (isCorrect) {
                const missed = !!scored.missedThisRound;
                if (dbMask) {
                    dbMask.history = [...(dbMask.history || []), '〇'].slice(-10);
                    dbMask.trainingPoints = missed ? Math.max(0, (dbMask.trainingPoints || 0) - 1) : 0;
                }
                scored.trainingPoints = dbMask?.trainingPoints ?? 0;
                scored.isAnswered = true;
                const note = scored.id === targetMask.id ? '' : `（「${scored.text}」のマスクを外しました）`;
                Utils.updateMessage(`✅ 正解！ (鍛錬ポイント ${scored.trainingPoints})${note}`, 'success');
                UIManager.showAnimation(scored.id, 'correct');
                try { new Audio('sounds/correct.mp3').play().catch(() => {}); } catch (e) {}
                this.clearTextInput();
            } else {
                const firstMiss = !targetMask.missedThisRound;
                if (dbMask && firstMiss) {
                    dbMask.history = [...(dbMask.history || []), '×'].slice(-10);
                    dbMask.trainingPoints = (dbMask.trainingPoints || 0) + 2;
                }
                targetMask.missedThisRound = true;
                targetMask.trainingPoints = dbMask?.trainingPoints ?? 0;
                Utils.updateMessage(`❌ 不正解！ (鍛錬ポイント ${targetMask.trainingPoints})`, 'error');
                UIManager.showAnimation(targetMask.id, 'incorrect');
                this.clearTextInput(true);
            }

            if (quizBook) await DBManager.updateQuizBook(quizBook);
        },



        clearTextInput(shake = false) {
            if (AppState.currentAnsweringMaskId) {
                AppState.currentAnsweringMaskId = null;
                document.querySelector('.active-mask-highlight')?.classList.remove('active-mask-highlight');
                if (shake) {
                    const inputContainer = DOM.exerciseTextInputContainer.querySelector('.bg-blue-50');
                    if(inputContainer) {
                        inputContainer.classList.add('shake-animation');
                        setTimeout(() => inputContainer.classList.remove('shake-animation'), 500);
                    }
                } else {
                    this.initializeTextInputContainer();
                }
            }
        },

                       // ★追加：現在のラウンドで解答対象になっているマスク
                // ★追加：マスクを読み順（上の行から、行内は左から右）に並べる
        sortMasksInReadingOrder(masks) {
            const rows = [];
            [...masks].sort((a, b) => a.rect.y - b.rect.y).forEach(m => {
                const cy = m.rect.y + m.rect.height / 2;
                const row = rows.find(r => cy >= r.top && cy <= r.bottom);
                if (row) {
                    row.items.push(m);
                    row.top = Math.min(row.top, m.rect.y);
                    row.bottom = Math.max(row.bottom, m.rect.y + m.rect.height);
                } else {
                    rows.push({ top: m.rect.y, bottom: m.rect.y + m.rect.height, items: [m] });
                }
            });
            rows.forEach(r => r.items.sort((a, b) => a.rect.x - b.rect.x));
            return rows.flatMap(r => r.items);
        },

        // ★追加：指定マスクの次に解答すべきマスクを返す（横優先→下の行へ）
        getNextMaskAfter(quiz, mask) {
            const ordered = this.sortMasksInReadingOrder(this.getActiveMasks(quiz));
            if (!ordered.length) return null;
            if (!mask) return ordered[0];

            const cy = mask.rect.y + mask.rect.height / 2;
            // ① 同じ行にあって右側のマスク
            const right = ordered
                .filter(m => cy >= m.rect.y && cy <= m.rect.y + m.rect.height && m.rect.x > mask.rect.x)
                .sort((a, b) => a.rect.x - b.rect.x)[0];
            if (right) return right;
            // ② 下の行の先頭（orderedは読み順なので最初に見つかるものが該当）
            const below = ordered.find(m => (m.rect.y + m.rect.height / 2) > cy);
            if (below) return below;
            // ③ 最後まで行ったら先頭へ折り返す
            return ordered[0];
        },


        getActiveMasks(quiz) {
            if (!quiz?.problemData) return [];
            return AppState.isFirstRound
                ? quiz.problemData.filter(m => !m.isAnswered)
                : quiz.problemData.filter(m => !m.isAnswered && (m.trainingPoints || 0) > 0);
        },

        updateScreenAfterAnswer(quiz, wasCorrect = true, lastMaskId = null) {
            CanvasManager.redrawCanvas(DOM.imageCanvasExercise);
            this.setupDropZones();
            this.setupExerciseOptions();

             const active = this.getActiveMasks(quiz);
            if (active.length === 0) {
                // ★この周で間違えたマスクだけを、もう一周この問題内で出す
                const redo = quiz.problemData.filter(m => m.missedThisRound);
                if (redo.length > 0) {
                    const round = (quiz.redoRound || 1) + 1;
                    quiz.redoRound = round;
                    Utils.updateMessage(`🔥 ${round}周目：間違えた ${redo.length} 問をやり直します`, 'info');
                    setTimeout(() => {
                        redo.forEach(m => { m.isAnswered = false; m.missedThisRound = false; });
                        CanvasManager.redrawCanvas(DOM.imageCanvasExercise);
                        this.setupDropZones();
                        this.setupExerciseOptions();
                        if (!AppState.isMobileMode) this.focusFirstMask();
                        Utils.updateMessage(`🔥 ${round}周目：残り ${redo.length} 問`, 'info');
                    }, 1200);
                    return;
                }
                this.moveToNextProblemOrEndRound();
                return;
            }

            this.updateTrainingPointsDisplay();
            if (AppState.isMobileMode) return;

            setTimeout(() => {
               const zones = DOM.dropZoneContainerExercise;
                let zone = (!wasCorrect && lastMaskId)
                    ? zones.querySelector(`[data-mask-id="${lastMaskId}"]`)
                    : null;
                if (!zone) {
                    const next = quiz.problemData.find(m => !m.isAnswered
                        && (AppState.isFirstRound || (m.trainingPoints || 0) > 0));
                    zone = next ? zones.querySelector(`[data-mask-id="${next.id}"]`) : null;
                }
                zone?.click();
            }, 300);

        },



               moveToNextProblemOrEndRound() {
            if (AppState.currentProblemIndexExercise < AppState.exerciseData.length - 1) {
                AppState.currentProblemIndexExercise++;
                this.loadExerciseProblem();
                return;
            }
            // 最後の問題まで来た。鍛錬ポイントが残っていれば何周でも繰り返す
            const remain = AppState.exerciseData.reduce((sum, q) =>
                sum + q.problemData.reduce((s, m) => s + (m.trainingPoints || 0), 0), 0);
            if (remain === 0) return UIManager.showSpectacularClearAnimation(true);

            AppState.isFirstRound = false;
            AppState.exerciseRound++;
            AppState.currentProblemIndexExercise = 0;
            Utils.updateMessage(`🔥 ${AppState.exerciseRound}周目の鍛錬を開始します（残り鍛錬ポイント ${remain}）`, 'info');
            this.loadExerciseProblem();
        },

    };
    
    // --- 9. PanZoomManager and SpeechManager (変更なし) ---
    const PanZoomManager = {
        handlePanStart(e) {
            if (e.target.closest('.drop-zone-element, #exerciseTextInputContainer, #zoomSliderContainer')) return;
            e.preventDefault();
            AppState.isPanning = true;
            const panEvent = e.touches ? e.touches[0] : e;
            AppState.panStart = { x: panEvent.clientX, y: panEvent.clientY };
            AppState.panStartScroll = { left: DOM.imageContainerWrapperExercise.scrollLeft, top: DOM.imageContainerWrapperExercise.scrollTop };
            DOM.imageContainerWrapperExercise.style.cursor = 'grabbing';
        },
        handlePanMove(e) {
            if (!AppState.isPanning) return;
            e.preventDefault();
            const panEvent = e.touches ? e.touches[0] : e;
            const dx = panEvent.clientX - AppState.panStart.x;
            const dy = panEvent.clientY - AppState.panStart.y;
            DOM.imageContainerWrapperExercise.scrollLeft = AppState.panStartScroll.left - dx;
            DOM.imageContainerWrapperExercise.scrollTop = AppState.panStartScroll.top - dy;
        },
        handlePanEnd() {
            if (!AppState.isPanning) return;
            AppState.isPanning = false;
            DOM.imageContainerWrapperExercise.style.cursor = 'grab';
        },
        handleZoom(e) {
            const scale = e.target.value;
            DOM.zoomValue.textContent = `${Number(scale).toFixed(1)}x`;
            DOM.imageDisplayAreaExercise.style.transform = `scale(${scale})`;
        }
    };
        const SpeechManager = {
        micActive: false,   // ユーザーがマイクONにしている意思
        restartTimer: null,

        setup() {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (!SpeechRecognition) return;
            const recognition = new SpeechRecognition();
            Object.assign(recognition, { lang: 'ja-JP', interimResults: false, continuous: true });

            recognition.onstart = () => {
                AppState.isRecognizing = true;
                this.updateMicButtonUI();
                Utils.updateMessage('🎤 連続音声入力中（停止するにはマイクボタンを押してください）', 'info');
            };

            recognition.onresult = (e) => {
                for (let i = e.resultIndex; i < e.results.length; i++) {
                    if (!e.results[i].isFinal) continue;
                    const transcript = (e.results[i][0].transcript || '').trim();
                    if (!transcript) continue;
                    const maskId = AppState.currentAnsweringMaskId;
                    if (!maskId) continue;
                    const input = document.getElementById('mask-text-input');
                    if (input) input.value = transcript;
                    ExerciseModeManager.checkAnswer(transcript, maskId);
                }
            };

            recognition.onerror = (e) => {
                if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
                    this.micActive = false;
                    Utils.updateMessage('マイクの使用が許可されていません。', 'error');
                }
            };

            recognition.onend = () => {
                AppState.isRecognizing = false;
                if (this.micActive) {
                    clearTimeout(this.restartTimer);
                    this.restartTimer = setTimeout(() => {
                        if (!this.micActive) return;
                        try { recognition.start(); } catch (err) {}
                    }, 300);
                } else {
                    this.updateMicButtonUI();
                }
            };

            AppState.speechRecognition = recognition;
        },

        start() {
            if (!AppState.speechRecognition) {
                Utils.updateMessage('このブラウザは音声入力に対応していません（Chrome推奨）。', 'error');
                return;
            }
            this.micActive = true;
            this.updateMicButtonUI();
            if (AppState.isRecognizing) return;
            try { AppState.speechRecognition.start(); } catch (err) {}
        },

        stop() {
            this.micActive = false;
            clearTimeout(this.restartTimer);
            try { AppState.speechRecognition?.stop(); } catch (err) {}
            this.updateMicButtonUI();
        },

        toggle() { this.micActive ? this.stop() : this.start(); },

        updateMicButtonUI() {
            const btn = document.getElementById('mic-start-btn');
            if (!btn) return;
            btn.classList.toggle('is-recording', this.micActive);
            btn.textContent = this.micActive ? '🔴' : '🎤';
            btn.title = this.micActive ? '音声入力を停止' : '音声入力を開始（連続）';
        }
    };

    
    // --- 10. Event Manager (スマホモード対応) ---
    const EventManager = {
        setup() {
            document.body.addEventListener('click', this.handleGlobalClick.bind(this));
            DOM.addNewQuizInput?.addEventListener('change', e => { if (e.target.files[0]) CanvasManager.handleImageUpload(e.target.files[0]); e.target.value = ''; });
            DOM.importFromJsonInput?.addEventListener('change', e => { if(e.target.files[0]) DBManager.importFromFile(e.target.files[0]); e.target.value = ''; });
            DOM.imageCanvas?.addEventListener('click', this.handleCanvasClick.bind(this));
            DOM.imageCanvas?.addEventListener('mousedown', CreationModeManager.handleMouseDown.bind(CreationModeManager));
            document.addEventListener('mousemove', e => { CreationModeManager.handleMouseMove(e); PanZoomManager.handlePanMove(e); });
            document.addEventListener('mouseup', e => { CreationModeManager.handleMouseUp(e); PanZoomManager.handlePanEnd(e); });
            DOM.zoomSlider?.addEventListener('input', PanZoomManager.handleZoom);
                        let _fitResizeTimer = null;
            window.addEventListener('resize', () => {
                clearTimeout(_fitResizeTimer);
                _fitResizeTimer = setTimeout(() => {
                    if (AppState.currentMode !== 'exercise') return;
                    const q = AppState.getCurrentExerciseQuiz();
                    if (q?.originalImage?.complete) CanvasManager.setupCanvas(q.originalImage, DOM.imageCanvasExercise);
                }, 200);
            });

            const exerciseContainer = DOM.imageContainerWrapperExercise;
            if(exerciseContainer) {
                exerciseContainer.addEventListener('mousedown', PanZoomManager.handlePanStart);
                exerciseContainer.addEventListener('touchstart', PanZoomManager.handlePanStart, { passive: false });
                document.addEventListener('touchmove', PanZoomManager.handlePanMove, { passive: false });
                document.addEventListener('touchend', PanZoomManager.handlePanEnd);
            }
            DOM.optionsContainerCreation?.addEventListener('click', this.handleCreationOptionsClick.bind(this));
        },

        async handleCanvasClick(e) {
        if (AppState.suppressNextCanvasClick) { AppState.suppressNextCanvasClick = false; return; }

            if (AppState.currentMode !== 'creation' || (!AppState.isGroupSelectMode && !AppState.importanceSelectMode)) return;
            const rect = DOM.imageCanvas.getBoundingClientRect();
            const clickX = e.clientX - rect.left; const clickY = e.clientY - rect.top;
            const quiz = AppState.getCurrentCreationQuiz();
            if (!quiz?.problemData) return;
            const clickedMask = [...quiz.problemData].reverse().find(m => {
                const maskRect = { x: m.rect.x * rect.width, y: m.rect.y * rect.height, width: m.rect.width * rect.width, height: m.rect.height * rect.height };
                return clickX >= maskRect.x && clickX <= maskRect.x + maskRect.width && clickY >= maskRect.y && clickY <= maskRect.y + maskRect.height;
            });
            if (clickedMask) {
                if (AppState.isGroupSelectMode) clickedMask.groupId = AppState.selectedGroupId === 'null' ? null : AppState.selectedGroupId;
                else if (AppState.importanceSelectMode) clickedMask.importance = AppState.selectedImportance;
                await DBManager.updateQuizBook(AppState.getCurrentQuizBook());
                CreationModeManager.updateMaskList();
            }
        },

                async handleCreationOptionsClick(e) {
            const wrapper = e.target.closest('.option-item-wrapper');
            if (!wrapper) return;
            if (e.target.closest('[data-action]')) return;

            if (AppState.importanceSelectMode || AppState.isGroupSelectMode) {
                return Utils.updateMessage('一括設定モード中です。「解除」を押してからテキストを編集してください。', 'info');
            }
            await CreationModeManager.editMaskText(wrapper.dataset.maskId);
        },


        async handleGlobalClick(e) {
            const target = e.target.closest('[data-action]');
            if (!target) return;
            const action = target.dataset.action;
            const bookId = target.closest('[data-book-id]')?.dataset.bookId;
            const quizId = target.dataset.quizId || target.closest('[data-quiz-id]')?.dataset.quizId;
            const maskId = target.dataset.maskId || target.closest('[data-mask-id]')?.dataset.maskId;
            await this.dispatchAction(action, { bookId, quizId, maskId, target });
        },

        async dispatchAction(action, { bookId, quizId, maskId, target }) {
            const handlers = {
                'switch-mode': () => UIManager.switchToMode(target.dataset.mode),
                'create-new-book': CanvasManager.handleNewBookCreation,
                'reset-all': this.handleResetAll,
                'export-all-data': this.handleExportAll,
                'toggle-mobile-mode': this.handleToggleMobileMode,
                'toggle-stamp-mode': () => {          // ★追加
                    AppState.stampMode = !AppState.stampMode;

                    const btn = document.getElementById('stampModeButton');
                    if (btn) {
                        btn.textContent = AppState.stampMode ? 'スタンプON' : 'スタンプOFF';
                        btn.classList.toggle('bg-orange-500', AppState.stampMode);
                        btn.classList.toggle('bg-gray-500', !AppState.stampMode);
                    }
                    Utils.updateMessage(AppState.stampMode
                        ? 'スタンプモードON：最初の1つをドラッグで作り、以降はクリックで同じ大きさのマスクを置けます。'
                        : 'スタンプモードOFF', 'info');
                },
                'select-book': () => { AppState.currentQuizBookId = bookId; UIManager.switchToMode('problemManagement'); },
                'rename-book': () => this.handleRenameBook(bookId),
                'delete-book': () => this.handleDeleteBook(bookId),
                'export-book': () => this.handleExportBook(bookId),
                'export-problem': () => this.handleExportProblem(quizId),
                'start-selected-exercise': this.handleStartSelectedExercise,
                                'toggle-select-all-problems': () => this.handleToggleSelectAllProblems(target),

                'edit-problem': () => UIManager.switchToMode('creation', { quizId }),
                'rename-problem': () => this.handleRenameProblem(quizId),
                'delete-problem': () => this.handleDeleteProblem(quizId),
                'open-problem-action-modal': () => UIManager.toggleProblemActionModal(true, quizId),
                'cancel-modal': () => UIManager.toggleProblemActionModal(false),
                'confirm-copy': this.handleConfirmCopy,
                'confirm-move': this.handleConfirmMove,
                'delete-mask-on-canvas': () => CreationModeManager.deleteMask(maskId),
                'delete-mask': () => CreationModeManager.deleteMask(maskId),
             'edit-mask-text': () => CreationModeManager.editMaskText(maskId),
               　'clear-all-groups': () => CreationModeManager.clearAllGroupsInCurrentQuiz(),
                'clear-all-importance': () => CreationModeManager.clearAllImportanceInCurrentQuiz(),


                'exercise-problem': () => this.handleExerciseProblem(quizId),
                'exercise-current': () => { const q = AppState.getCurrentCreationQuiz(); if (q?.problemData?.length) UIManager.switchToMode('exercise', { problems: [q] }); },
                'next-problem-exercise': () => { if (AppState.currentProblemIndexExercise < AppState.exerciseData.length - 1) { AppState.currentProblemIndexExercise++; ExerciseModeManager.loadExerciseProblem(); } },
                'prev-problem-exercise': () => { if (AppState.currentProblemIndexExercise > 0) { AppState.currentProblemIndexExercise--; ExerciseModeManager.loadExerciseProblem(); } },
                'next-problem-creation': () => { const b = AppState.getCurrentQuizBook(); if (b && AppState.currentProblemIndexCreation < b.quizzes.length - 1) { AppState.currentProblemIndexCreation++; CanvasManager.loadImageFromQuizData(b.quizzes[AppState.currentProblemIndexCreation], DOM.imageCanvas); } },
                'prev-problem-creation': () => { const b = AppState.getCurrentQuizBook(); if (b && AppState.currentProblemIndexCreation > 0) { AppState.currentProblemIndexCreation--; CanvasManager.loadImageFromQuizData(b.quizzes[AppState.currentProblemIndexCreation], DOM.imageCanvas); } },
                'retry-problem': this.handleRetryProblem,
                'start-filtered-exercise-in-session': this.handleStartFilteredExerciseInSession,
                'set-importance': () => this.handleSetImportance(target),
                'cancel-importance-mode': this.handleCancelImportanceMode,
                'set-group': () => this.handleSetGroup(target),
                'cancel-group-mode': this.handleCancelGroupMode,
                'start-filtered-exercise': this.handleStartFilteredExercise,
                'edit-current-exercise': () => { const q = AppState.getCurrentExerciseQuiz(); if (q) UIManager.switchToMode('creation', { quizId: q.id }); }
            };
            if (handlers[action]) await handlers[action]();
        },
        
        handleToggleMobileMode() {
            AppState.isMobileMode = !AppState.isMobileMode;
            document.body.classList.toggle('mobile-mode');
            DOM.toggleMobileModeButton.textContent = AppState.isMobileMode ? '💻 PCモードに切替' : '📱 スマホモードに切替';
            const exerciseTitle = AppState.isMobileMode ? '（タップ操作）' : '（ドラッグ＆ドロップまたはテキスト入力）';
            Utils.updateMessage(`モードを切り替えました: ${AppState.isMobileMode ? 'スマホモード' : 'PCモード'}`, 'success');
            // 演習モードの場合、UIを再描画
            if (AppState.currentMode === 'exercise') {
                ExerciseModeManager.initializeTextInputContainer();
                ExerciseModeManager.setupDropZones();
                ExerciseModeManager.setupExerciseOptions();
                Utils.updateMessage(`演習を続行します。${exerciseTitle}`, 'info');
            }
        },

        async handleResetAll() { if (confirm('本当にすべてのデータを削除しますか？')) { await db.clear(STORE_NAME); await DBManager.loadAllQuizBooks(); UIManager.switchToMode('menu'); Utils.updateMessage('全データを削除しました。', 'success'); } },
        handleExportAll() { Utils.downloadJSON(AppState.masterQuizList, 'quiz_app_all_data.json'); Utils.updateMessage('全データをエクスポートしました。', 'success'); },
        async handleRenameBook(bookId) { const b = AppState.masterQuizList.find(b => b.id === bookId); if(!b) return; const n = prompt('新しい名前:', b.name); if (n?.trim()) { b.name = n.trim(); await DBManager.updateQuizBook(b); UIManager.refreshQuizBookList(); Utils.updateMessage('名前を変更しました。', 'success'); } },
        async handleDeleteBook(bookId) { if (confirm('この問題集を削除しますか？')) { await DBManager.deleteQuizBook(bookId); await DBManager.loadAllQuizBooks(); UIManager.refreshQuizBookList(); Utils.updateMessage('問題集を削除しました。', 'success'); } },
        handleExportBook(bookId) { const b = AppState.masterQuizList.find(b => b.id === bookId); if(b) Utils.downloadJSON(b, `問題集_${b.name}.json`); },
        handleExportProblem(quizId) { const q = AppState.getCurrentQuizBook()?.quizzes.find(q => q.id === quizId); if(q) Utils.downloadJSON(q, `問題_${q.title.replace(/[\\/:"*?<>|]/g, '_')}.json`); },
        
               handleToggleSelectAllProblems(target) {
            const on = !!(target && target.checked);
            document.querySelectorAll('.problem-select-cb').forEach(cb => { cb.checked = on; });
            UIManager.updateSelectedProblemCount();
            Utils.updateMessage(on ? 'すべての問題を選択しました。' : '選択をすべて解除しました。', 'info');
        },



        handleStartSelectedExercise() {
            const selectedIds = Array.from(document.querySelectorAll('.problem-select-cb:checked')).map(cb => cb.dataset.quizId);
            if (selectedIds.length === 0) return Utils.updateMessage('演習する問題を1つ以上選択してください。', 'info');
            const selectedQuizzes = AppState.getCurrentQuizBook().quizzes.filter(q => selectedIds.includes(q.id) && q.problemData?.length > 0);
            if (selectedQuizzes.length > 0) UIManager.switchToMode('exercise', { problems: selectedQuizzes });
            else Utils.updateMessage('選択された問題に演習可能なマスクがありません。', 'info');
        },



        async handleRenameProblem(quizId) { const b = AppState.getCurrentQuizBook(); const q = b.quizzes.find(q => q.id === quizId); if(!q) return; const n = prompt('新しい名前:', q.title); if(n?.trim()) { q.title = n.trim(); await DBManager.updateQuizBook(b); UIManager.refreshProblemList(); } },
        async handleDeleteProblem(quizId) { if (confirm('この問題を削除しますか？')) { const b = AppState.getCurrentQuizBook(); b.quizzes = b.quizzes.filter(q => q.id !== quizId); await DBManager.updateQuizBook(b); await DBManager.loadAllQuizBooks(); if(AppState.currentMode === 'creation') UIManager.switchToMode('problemManagement'); else UIManager.refreshProblemList(); Utils.updateMessage('問題を削除しました。', 'success'); } },
        async handleConfirmCopy() { const { sourceBookId, quizId } = AppState.problemToAction; const targetBookId = DOM.targetQuizBookSelect.value; const sB = AppState.masterQuizList.find(b => b.id === sourceBookId); const tB = AppState.masterQuizList.find(b => b.id === targetBookId); const q = sB?.quizzes.find(q => q.id === quizId); if(!sB || !tB || !q) return; const cQ = JSON.parse(JSON.stringify(q)); cQ.id = Utils.generateId(); tB.quizzes.push(cQ); await DBManager.updateQuizBook(tB); await DBManager.loadAllQuizBooks(); UIManager.refreshProblemList(); UIManager.toggleProblemActionModal(false); Utils.updateMessage(`「${cQ.title}」を「${tB.name}」に複製しました。`, 'success'); },
        async handleConfirmMove() { const { sourceBookId, quizId } = AppState.problemToAction; const targetBookId = DOM.targetQuizBookSelect.value; if(sourceBookId === targetBookId) return Utils.updateMessage('同じ問題集には移動できません。', 'error'); const sB = AppState.masterQuizList.find(b => b.id === sourceBookId); const tB = AppState.masterQuizList.find(b => b.id === targetBookId); const qIdx = sB?.quizzes.findIndex(q => q.id === quizId); if(!sB || !tB || qIdx === -1) return; const [q] = sB.quizzes.splice(qIdx, 1); tB.quizzes.push(q); await Promise.all([DBManager.updateQuizBook(sB), DBManager.updateQuizBook(tB)]); await DBManager.loadAllQuizBooks(); UIManager.refreshProblemList(); UIManager.toggleProblemActionModal(false); Utils.updateMessage(`「${q.title}」を「${tB.name}」に移動しました。`, 'success'); },
        handleExerciseProblem(quizId) { const q = AppState.getCurrentQuizBook()?.quizzes.find(q => q.id === quizId); if(q?.problemData?.length) UIManager.switchToMode('exercise', { problems: [q] }); else Utils.updateMessage('この問題にはマスクがありません。', 'error'); },
        async handleRetryProblem() { const book = AppState.masterQuizList.find(b => b.id === AppState.currentQuizBookId); if(!book) return; book.quizzes.forEach(q => { if (AppState.originalExerciseProblems.some(o => o.id === q.id)) q.problemData.forEach(m => { m.trainingPoints = 0; m.history = []; }); }); await DBManager.updateQuizBook(book); await DBManager.loadAllQuizBooks(); const newSet = AppState.getCurrentQuizBook().quizzes.filter(q => AppState.originalExerciseProblems.some(o => o.id === q.id)); ExerciseModeManager.startExerciseMode(newSet); Utils.updateMessage('鍛錬ポイントをリセットしました。', 'info'); },
                        handleStartFilteredExerciseInSession() {
            const levels = Array.from(document.querySelectorAll('.importance-filter-cb-exercise:checked')).map(cb => EventManager.importanceLevel (cb.value));
            if (levels.length === 0) return Utils.updateMessage('重要度を1つ以上選択してください。', 'info');

            const source = AppState.exerciseMasterProblems || AppState.originalExerciseProblems || [];
            if (source.length === 0) return Utils.updateMessage('演習の原本データが見つかりません。', 'error');
            const master = JSON.parse(JSON.stringify(source)); // 原本を退避

            const fP = JSON.parse(JSON.stringify(master)).map(q => {
                q.problemData = (q.problemData || []).filter(m => levels.includes(EventManager.importanceLevel (m.importance)));
                return q;
            }).filter(q => q.problemData.length > 0);

            if (fP.length === 0) {
                const all = [...new Set(master.flatMap(q => (q.problemData || []).map(m => EventManager.importanceLevel (m.importance))))].sort();
                return Utils.updateMessage(`該当マスクがありません（この演習に含まれる重要度: ${all.map(n => '☆'.repeat(n)).join('・') || 'なし'}）`, 'info');
            }

            ExerciseModeManager.startExerciseMode(fP);
            AppState.exerciseMasterProblems = master; // startExerciseMode で上書きされた原本を復元
            Utils.updateMessage(`重要度 ${levels.map(n => '☆'.repeat(n)).join('・')} で絞り込みました（${fP.reduce((s, q) => s + q.problemData.length, 0)}マスク）`, 'success');
        },


        handleSetImportance(target) { AppState.importanceSelectMode = true; AppState.isGroupSelectMode = false; AppState.selectedImportance = target.dataset.importance; Utils.updateMessage(`重要度「${target.dataset.importance}」を選択中。マスクをクリックして設定。`, 'info'); document.querySelectorAll('.importance-setter-btn').forEach(b => b.classList.remove('bg-blue-500', 'text-white')); target.classList.add('bg-blue-500', 'text-white'); },
        handleCancelImportanceMode() { AppState.importanceSelectMode = false; Utils.updateMessage('重要度一括設定を解除しました。', 'info'); document.querySelectorAll('.importance-setter-btn').forEach(b => b.classList.remove('bg-blue-500', 'text-white')); },
        handleSetGroup(target) { AppState.isGroupSelectMode = true; AppState.importanceSelectMode = false; AppState.selectedGroupId = target.dataset.groupId; Utils.updateMessage(`グループ「${target.dataset.groupId === 'null' ? '未設定' : target.dataset.groupId}」を選択中。マスクをクリックして設定。`, 'info'); document.querySelectorAll('.group-setter-btn').forEach(b => b.classList.remove('bg-green-500', 'text-white')); target.classList.add('bg-green-500', 'text-white'); },
        handleCancelGroupMode() { AppState.isGroupSelectMode = false; Utils.updateMessage('グループ一括設定を解除しました。', 'info'); document.querySelectorAll('.group-setter-btn').forEach(b => b.classList.remove('bg-green-500', 'text-white')); },
                importanceLevel(v) {
            const s = String(v ?? '').trim();
            if (!s) return 1;
            const stars = (s.match(/[☆★✩✭⭐]/g) || []).length;
            if (stars) return stars;
            const n = parseInt(s.replace(/[^0-9]/g, ''), 10);
            return Number.isFinite(n) && n > 0 ? n : 1;
        },

        handleStartFilteredExercise() {
            const levels = Array.from(document.querySelectorAll('.importance-filter-cb:checked')).map(cb => EventManager.importanceLevel (cb.value));
            if (levels.length === 0) return Utils.updateMessage('重要度を1つ以上選択してください。', 'info');
            const qB = AppState.getCurrentQuizBook();
            if (!qB) return Utils.updateMessage('問題集が選択されていません。', 'error');
            const fP = (qB.quizzes || []).map(q => {
                const fQ = JSON.parse(JSON.stringify(q));
                fQ.problemData = (fQ.problemData || []).filter(m => levels.includes(EventManager.importanceLevel (m.importance)));
                return fQ;
            }).filter(q => q.problemData.length > 0);
            if (fP.length > 0) UIManager.switchToMode('exercise', { problems: fP });
            else Utils.updateMessage(`重要度 ${levels.map(n => '☆'.repeat(n)).join('・')} に該当するマスクがありませんでした。`, 'info');
        }

    };

    // --- Final Initialization ---
    async function initialize() {
        try {
            await DBManager.initDB();
            await DBManager.loadAllQuizBooks();
            UIManager.initializeGroupButtons();
            EventManager.setup();
            SpeechManager.setup();
            const style = document.createElement('style');
            style.textContent = `@keyframes confettiFall { 0% { transform: translateY(-20px); opacity: 1; } 100% { transform: translateY(100vh) rotate(720deg); opacity: 0; } } @keyframes sparkleFloat { 0% { transform: translateY(0px) scale(0.5); opacity: 0; } 25% { transform: translateY(-20px) scale(1.2); opacity: 1; } 100% { transform: translateY(-40px) scale(0.3); opacity: 0; } }`;
            document.head.appendChild(style);
            UIManager.switchToMode('menu');
            console.log('✅ Application Ready.');
        } catch (error) {
            console.error('❌ Initialization failed:', error);
            Utils.updateMessage('アプリケーションの初期化に失敗しました。', 'error');
        }
    }
    initialize();
});
