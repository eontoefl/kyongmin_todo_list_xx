/* ==========================================
   KYONGMIN's Todo List — App Logic v3
   ==========================================
   - LocalStorage 기반 오프라인 동작
   - 드래그 앤 드롭 순서 조정 + 서브태스크 변환
   - ⚡ 빠른 할 일 (10분 내 완료) 분류 & 별도 섹션
   - parentId 기반 서브태스크
   - 블록 에디터 스타일: 항상 커서가 있는 입력행,
     Enter → 새 행 생성, Tab → 서브태스크화
   ========================================== */

(function () {
    'use strict';

    const STORAGE_KEY = 'kyongmin_todo_data';
    const SORT_KEY = 'kyongmin_todo_sort';
    const ORDER_KEY = 'kyongmin_todo_order';

    let todos = [];
    let manualOrder = [];
    let currentFilter = 'all';
    let currentCategory = null;
    let currentSort = 'dueDate';
    let searchQuery = '';
    let editingId = null;
    let draggedId = null;

    // Focus management
    let focusTargetId = null; // after render, focus this todo's input
    let focusNewRow = false;  // after render, focus the new-row input
    let animateNewId = null;  // 새로 생성된 행만 애니메이션

    // 서브태스크 접기/펼치기 상태 (기본: 펼침)
    const collapsedIds = new Set();

    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    const todoList = $('#todoList');
    const emptyState = $('#emptyState');
    const searchInput = $('#searchInput');
    const sortBtn = $('#sortBtn');
    const sortDropdown = $('#sortDropdown');
    const menuToggle = $('#menuToggle');
    const sidebar = $('#sidebar');
    const clearCompletedBtn = $('#clearCompletedBtn');
    const editModal = $('#editModal');
    const headerTitle = $('#headerTitle');
    const headerDate = $('#headerDate');

    const totalTasks = $('#totalTasks');
    const completedTasks = $('#completedTasks');
    const pendingTasks = $('#pendingTasks');
    const progressPercent = $('#progressPercent');
    const progressFill = $('#progressFill');
    const badgeAll = $('#badgeAll');
    const badgeActive = $('#badgeActive');
    const badgeCompleted = $('#badgeCompleted');
    const badgeImportant = $('#badgeImportant');
    const badgeQuick = $('#badgeQuick');

    const quickTaskSection = $('#quickTaskSection');
    const quickTaskList = $('#quickTaskList');
    const quickTaskCount = $('#quickTaskCount');
    const normalSectionHeader = $('#normalSectionHeader');

    const editTodoInput = $('#editTodoInput');
    const editCategorySelect = $('#editCategorySelect');
    const editDueDateInput = $('#editDueDateInput');
    const editNoteInput = $('#editNoteInput');
    const editQuickToggle = $('#editQuickToggle');
    const modalClose = $('#modalClose');
    const modalCancel = $('#modalCancel');
    const modalSave = $('#modalSave');

    // ==========================================
    // Utilities
    // ==========================================
    function generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
    }

    function formatDate(dateStr) {
        if (!dateStr) return '';
        const date = new Date(dateStr + 'T00:00:00');
        const today = new Date(); today.setHours(0,0,0,0);
        const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate()+1);
        const targetDate = new Date(dateStr + 'T00:00:00');
        if (targetDate.getTime() === today.getTime()) return '오늘';
        if (targetDate.getTime() === tomorrow.getTime()) return '내일';
        const diff = targetDate.getTime() - today.getTime();
        const days = Math.ceil(diff / (1000*60*60*24));
        if (days < 0) return `${Math.abs(days)}일 지남`;
        if (days <= 7) return `${days}일 남음`;
        return `${date.getMonth()+1}/${date.getDate()}`;
    }

    function getDueStatus(dateStr) {
        if (!dateStr) return '';
        const today = new Date(); today.setHours(0,0,0,0);
        const targetDate = new Date(dateStr + 'T00:00:00');
        if (targetDate < today) return 'overdue';
        if (targetDate.getTime() === today.getTime()) return 'today';
        const diff = Math.ceil((targetDate - today) / (1000*60*60*24));
        if (diff === 1) return 'tomorrow';
        if (diff <= 3) return 'soon';     // 2~3일
        if (diff <= 7) return 'week';     // 4~7일
        return 'later';                   // 7일 초과
    }

    function getCategoryLabel(cat) {
        const map = { personal:'개인', work:'업무', study:'학습', health:'건강', shopping:'쇼핑' };
        return map[cat] || cat;
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ==========================================
    // Tree helpers
    // ==========================================
    function getChildren(parentId) { return todos.filter(t => t.parentId === parentId); }
    function isTopLevel(todo) { return !todo.parentId; }

    // 서브태스크의 최상위 부모가 완료됐는지 확인
    function isAncestorCompleted(todo) {
        let pid = todo.parentId;
        while (pid) {
            const p = todos.find(t => t.id === pid);
            if (!p) return false;
            if (!p.parentId) return p.completed; // 최상위 도달
            pid = p.parentId;
        }
        return false;
    }

    // "완료 캘린더"에 들어갈 자격이 있는지: 본인 완료 + (서브태스크면 최상위 부모도 완료)
    function isDoneForCalendar(t) {
        if (t.type === 'text') return false;
        if (!t.completed || !t.completedAt) return false;
        if (t.parentId) return isAncestorCompleted(t);
        return true;
    }

    function getDepth(todo) {
        let d = 0, c = todo;
        while (c.parentId) { d++; c = todos.find(t => t.id === c.parentId); if (!c) break; }
        return d;
    }

    function getDescendantIds(pid) {
        const ids = [];
        for (const ch of getChildren(pid)) { ids.push(ch.id); ids.push(...getDescendantIds(ch.id)); }
        return ids;
    }

    function buildOrderedList(filteredTodos) {
        const topLevel = filteredTodos.filter(t => isTopLevel(t));
        const result = [];
        // manual 정렬일 때만 manualOrder 적용, 그 외는 getFilteredTodos 정렬 유지
        if (currentSort === 'manual') {
            const orderMap = {}; manualOrder.forEach((id,i) => orderMap[id]=i);
            topLevel.sort((a,b) => (orderMap[a.id]??9999) - (orderMap[b.id]??9999));
            function addManual(todo) {
                result.push(todo);
                const ch = filteredTodos.filter(t => t.parentId === todo.id);
                ch.sort((a,b) => (orderMap[a.id]??9999) - (orderMap[b.id]??9999));
                ch.forEach(addManual);
            }
            topLevel.forEach(addManual);
        } else {
            // filteredTodos 순서를 그대로 유지하면서 부모 바로 뒤에 자식 삽입
            const added = new Set();
            function addTree(todo) {
                if (added.has(todo.id)) return;
                added.add(todo.id);
                result.push(todo);
                const ch = filteredTodos.filter(t => t.parentId === todo.id);
                ch.forEach(addTree);
            }
            topLevel.forEach(addTree);
        }
        return result;
    }

    // Get previous visible sibling (for Tab nesting)
    function getPrevVisibleItem(todoId, orderedList) {
        const idx = orderedList.findIndex(t => t.id === todoId);
        return idx > 0 ? orderedList[idx - 1] : null;
    }

    // ==========================================
    // Storage
    // ==========================================
    function saveTodos() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(todos));
            localStorage.setItem(ORDER_KEY, JSON.stringify(manualOrder));
        } catch(e) { showToast('저장 중 오류가 발생했습니다.','error'); }
    }

    // 초기 시드 데이터 (최초 실행 시 한 번만 사용)
    const SEED_DATA = [{"id":"mly4tm6j6li6tf4ko","text":"스피킹 인터뷰 나레이션에 사진이 안나옴.","completed":true,"category":"","important":false,"quickTask":false,"dueDate":null,"note":"","parentId":"mly11t2y8hetr37d2","createdAt":"2026-02-22T19:19:49.387Z","completedAt":"2026-02-22T19:49:54.155Z","type":"todo"},{"id":"mly4jh5f8f88dfgpr","text":"오늘자 해당되는 모든사람들 데드라인 하루 연장해주기","completed":false,"category":"","important":false,"quickTask":false,"dueDate":null,"note":"","parentId":null,"createdAt":"2026-02-22T19:11:56.307Z","completedAt":null,"type":"todo"},{"id":"mly4ho4sxorvvubk9","text":"박수인님 세팅하기 (입금완료)","completed":false,"category":"","important":false,"quickTask":false,"dueDate":null,"note":"","parentId":"mly4fr7hzlyqaq0qt","createdAt":"2026-02-22T19:10:32.044Z","completedAt":null,"type":"todo"},{"id":"mly4fr7hzlyqaq0qt","text":"변희성 3/1로 시작일자 이동","completed":false,"category":"","important":false,"quickTask":false,"dueDate":null,"note":"","parentId":null,"createdAt":"2026-02-22T19:09:02.717Z","completedAt":null,"type":"todo"},{"id":"mly4fe1p0eh6z624n","text":"팝업 관리시스템 (DB on/off)","completed":false,"category":"","important":false,"quickTask":false,"dueDate":null,"note":"","parentId":null,"createdAt":"2026-02-22T19:08:45.661Z","completedAt":null,"type":"todo"},{"id":"mly4eztvynxgymxci","text":"학생 오류제보 버튼","completed":false,"category":"","important":false,"quickTask":false,"dueDate":null,"note":"","parentId":null,"createdAt":"2026-02-22T19:08:27.235Z","completedAt":null,"type":"todo"},{"id":"mly4e7cr0ub4viy88","text":"연습풀이 오답노트 정책 결정","completed":false,"category":"","important":false,"quickTask":false,"dueDate":null,"note":"","parentId":null,"createdAt":"2026-02-22T19:07:50.331Z","completedAt":null,"type":"todo"},{"id":"mly141s7l4no0merr","text":"오답노트 패널 플로팅 위치 조정","completed":true,"category":"","important":false,"dueDate":null,"note":"","createdAt":"2026-02-22T17:35:57.703Z","completedAt":"2026-02-22T19:08:01.874Z","quickTask":true,"parentId":null,"type":"todo"},{"id":"mly13rs2t71fgf4bx","text":"해설 화면 1:1 문장 매칭 + (A)(B)(C)(D) 아이콘","completed":false,"category":"","important":false,"dueDate":null,"note":"","createdAt":"2026-02-22T17:35:44.738Z","completedAt":null,"quickTask":false,"parentId":null,"type":"todo"},{"id":"mly13oqagp9uz6cet","text":"실전풀이 1차/2차 채점 자동 저장","completed":false,"category":"","important":false,"dueDate":null,"note":"","createdAt":"2026-02-22T17:35:40.786Z","completedAt":null,"quickTask":false,"parentId":null,"type":"todo"},{"id":"mly13jsq4v55duud2","text":"과제 버튼 뱃지/체크 아이콘 겹침","completed":true,"category":"","important":false,"dueDate":null,"note":"","createdAt":"2026-02-22T17:35:34.395Z","completedAt":"2026-02-22T19:07:09.112Z","quickTask":true,"parentId":null,"type":"todo"},{"id":"mly13goy12ndsd7au","text":"리딩 해설 원문1줄+번역1줄 레이아웃","completed":false,"category":"","important":false,"dueDate":null,"note":"","createdAt":"2026-02-22T17:35:30.370Z","completedAt":null,"quickTask":false,"parentId":null,"type":"todo"},{"id":"mly13d6k0yv6vwt3l","text":"마이페이지 인증률 계산 로직 수정","completed":false,"category":"","important":false,"dueDate":null,"note":"","createdAt":"2026-02-22T17:35:25.820Z","completedAt":null,"quickTask":false,"parentId":null,"type":"todo"},{"id":"mly12ar2w43h7xe5y","text":"오답노트 저장 실패 버그 수정 (마이페이지 포함)","completed":true,"category":"","important":false,"dueDate":null,"note":"","createdAt":"2026-02-22T17:34:36.014Z","completedAt":"2026-02-22T21:20:31.333Z","quickTask":false,"parentId":null,"type":"todo"},{"id":"mly125dsjdx1a4w8l","text":"오디오 겹침 문제 확인","completed":false,"category":"","important":false,"dueDate":null,"note":"","createdAt":"2026-02-22T17:34:29.056Z","completedAt":null,"quickTask":false,"parentId":null,"type":"todo"},{"id":"mly122zs9bnjxnttb","text":"리스닝 해설화면 CSS 긴급 정리","completed":false,"category":"","important":false,"dueDate":null,"note":"","createdAt":"2026-02-22T17:34:25.960Z","completedAt":null,"quickTask":false,"parentId":null,"type":"todo"},{"id":"mly120liaqm62mi78","text":"실전풀이 vs 연습풀이 팝업 구분","completed":false,"category":"","important":false,"dueDate":null,"note":"","createdAt":"2026-02-22T17:34:22.855Z","completedAt":null,"quickTask":false,"parentId":null,"type":"todo"},{"id":"mly11vt0fxgjxcozq","text":"리딩 60% 인증률 버그 수정","completed":false,"category":"","important":false,"dueDate":null,"note":"","createdAt":"2026-02-22T17:34:16.644Z","completedAt":null,"quickTask":false,"parentId":null,"type":"todo"},{"id":"mly11t2y8hetr37d2","text":"내일 스케줄 대응 (리딩2, 리스닝1, 스피킹1 테스트)","completed":false,"category":"","important":false,"dueDate":null,"note":"","createdAt":"2026-02-22T17:34:13.114Z","completedAt":null,"quickTask":false,"parentId":null,"type":"todo"},{"id":"mly24gzq6z7wux9f7","text":"전섹션에 강제리로드 기능 추가","completed":true,"category":"","important":false,"quickTask":false,"dueDate":null,"note":"","parentId":"mly11t2y8hetr37d2","createdAt":"2026-02-22T17:34:13.114Z","completedAt":"2026-02-22T19:12:15.506Z","type":"todo"},{"id":"mly7aky3tjda4e43s","text":"연습풀이 오답노트 정책 결정","completed":false,"category":"","important":false,"quickTask":false,"dueDate":null,"note":"","parentId":null,"type":"todo","createdAt":"2026-02-22T20:29:00.171Z","completedAt":null}];

    function loadTodos() {
        try {
            const data = localStorage.getItem(STORAGE_KEY);
            todos = data ? JSON.parse(data) : SEED_DATA.map(t => ({...t}));
            todos.forEach(t => {
                if (typeof t.quickTask === 'undefined') t.quickTask = false;
                if (typeof t.parentId === 'undefined') t.parentId = null;
                if (typeof t.type === 'undefined') t.type = 'todo';
                // Legacy subtask migration
                if (Array.isArray(t.subtasks) && t.subtasks.length > 0) {
                    for (const sub of t.subtasks) {
                        const nt = { id:sub.id||generateId(), text:sub.text, completed:!!sub.done,
                            category:t.category||'', important:false, quickTask:false, dueDate:null, note:'',
                            parentId:t.id, createdAt:t.createdAt, completedAt:sub.done?new Date().toISOString():null };
                        if (!todos.find(x=>x.id===nt.id)) todos.push(nt);
                    }
                    delete t.subtasks;
                }
            });
            const order = localStorage.getItem(ORDER_KEY);
            manualOrder = order ? JSON.parse(order) : todos.map(t=>t.id);
            syncOrder();
        } catch(e) { todos=[]; manualOrder=[]; }
    }

    function syncOrder() {
        const ids = new Set(todos.map(t=>t.id));
        manualOrder = manualOrder.filter(id=>ids.has(id));
        todos.forEach(t => { if (!manualOrder.includes(t.id)) manualOrder.push(t.id); });
    }

    function loadSort() { const s=localStorage.getItem(SORT_KEY)||'dueDate'; currentSort=s==='priority'?'dueDate':s; }
    function saveSort() { localStorage.setItem(SORT_KEY,currentSort); }

    // ==========================================
    // CRUD
    // ==========================================
    function createTodo(text, parentId, type) {
        text = (text || '').trim();
        const todo = {
            id: generateId(), text: text, completed: false, category: '',
            important: false, quickTask: false, dueDate: null, note: '',
            parentId: parentId || null, type: type || 'todo',
            createdAt: new Date().toISOString(), completedAt: null
        };
        todos.push(todo);
        manualOrder.push(todo.id);
        animateNewId = todo.id;
        saveTodos();
        return todo;
    }

    function toggleTodo(id) {
        const todo = todos.find(t=>t.id===id);
        if (!todo) return;
        todo.completed = !todo.completed;
        todo.completedAt = todo.completed ? new Date().toISOString() : null;
        // 부모 자동완료: 서브태스크 전부 완료 → 부모 완료
        if (todo.parentId) {
            checkParentAutoComplete(todo.parentId);
        }
        saveTodos(); renderTodos(); updateStats();
        if (todo.completed) showToast('완료 처리됨','success');
    }

    function checkParentAutoComplete(parentId) {
        const parent = todos.find(t => t.id === parentId);
        if (!parent) return;
        const children = getChildren(parentId);
        if (children.length === 0) return;
        const allDone = children.every(c => c.completed);
        if (allDone && !parent.completed) {
            parent.completed = true;
            parent.completedAt = new Date().toISOString();
            // 재귀: 이 부모도 누군가의 자식이면 상위도 체크
            if (parent.parentId) checkParentAutoComplete(parent.parentId);
        } else if (!allDone && parent.completed) {
            // 서브태스크 하나라도 미완료로 돌리면 부모도 미완료
            parent.completed = false;
            parent.completedAt = null;
            if (parent.parentId) checkParentAutoComplete(parent.parentId);
        }
    }

    function deleteTodo(id) {
        const desc = getDescendantIds(id);
        const remove = new Set([id,...desc]);
        const el = document.querySelector(`.todo-row[data-id="${id}"]`);
        if (el) {
            el.classList.add('removing');
            setTimeout(() => {
                todos=todos.filter(t=>!remove.has(t.id));
                manualOrder=manualOrder.filter(o=>!remove.has(o));
                saveTodos(); focusNewRow=true; renderTodos(); updateStats();
                showToast('삭제됨','info');
            },250);
        } else {
            todos=todos.filter(t=>!remove.has(t.id));
            manualOrder=manualOrder.filter(o=>!remove.has(o));
            saveTodos(); focusNewRow=true; renderTodos(); updateStats();
        }
    }

    function toggleImportant(id) {
        const t=todos.find(t=>t.id===id); if(!t) return;
        t.important=!t.important; saveTodos(); renderTodos(); updateStats();
    }

    function toggleCollapse(id) {
        if (collapsedIds.has(id)) collapsedIds.delete(id);
        else collapsedIds.add(id);
        renderTodos();
    }

    function setParent(childId, newParentId) {
        const child=todos.find(t=>t.id===childId); if(!child) return;
        if (newParentId) {
            if (getDescendantIds(childId).includes(newParentId)) return;
            const p=todos.find(t=>t.id===newParentId);
            if (p && p.parentId) return; // max 1 depth
        }
        child.parentId = newParentId||null;
        saveTodos(); renderTodos(); updateStats();
    }

    function promoteToTopLevel(id) { setParent(id,null); showToast('독립 할 일로 변경됨','info'); }

    // ==========================================
    // Edit Modal (detail editing)
    // ==========================================
    function openEditModal(id) {
        const todo=todos.find(t=>t.id===id); if(!todo) return;
        editingId=id;
        editTodoInput.value=todo.text;
        editCategorySelect.value=todo.category;
        editDueDateInput.value=todo.dueDate||'';
        editNoteInput.value=todo.note||'';
        editQuickToggle.classList.toggle('active',!!todo.quickTask);
        editModal.classList.add('show');
        editTodoInput.focus();
    }

    function saveEdit() {
        if(!editingId) return;
        const todo=todos.find(t=>t.id===editingId); if(!todo) return;
        const text=editTodoInput.value.trim();
        if(!text){showToast('할 일을 입력해 주세요','info');return;}
        todo.text=text; todo.category=editCategorySelect.value;
        todo.dueDate=editDueDateInput.value||null;
        todo.note=editNoteInput.value.trim();
        todo.quickTask=editQuickToggle.classList.contains('active');
        saveTodos(); closeEditModal(); renderTodos(); updateStats();
        showToast('수정 완료','success');
    }

    function closeEditModal() { editModal.classList.remove('show'); editingId=null; }

    function clearCompleted() {
        const count=todos.filter(t=>t.completed).length;
        if(count===0){showToast('완료된 항목이 없습니다.','info');return;}
        if(confirm(`완료된 ${count}개의 항목을 삭제하시겠습니까?`)){
            const cids=new Set(todos.filter(t=>t.completed).map(t=>t.id));
            todos.forEach(t=>{if(cids.has(t.parentId))t.parentId=null;});
            todos=todos.filter(t=>!t.completed);
            manualOrder=manualOrder.filter(id=>!cids.has(id));
            saveTodos(); focusNewRow=true; renderTodos(); updateStats();
            showToast(`${count}개 삭제됨`,'success');
        }
    }

    // ==========================================
    // Filter & Sort
    // ==========================================
    function getFilteredTodos() {
        let f=[...todos];
        if(currentCategory) f=f.filter(t=>t.category===currentCategory);
        switch(currentFilter){
            case'active':f=f.filter(t=>{
                if(!t.completed) return true;
                // 서브태스크는 부모 소유 — 최상위 부모가 미완료면 진행중에 포함
                if(t.parentId && !isAncestorCompleted(t)) return true;
                return false;
            });break;
            case'completed':f=f.filter(t=>t.completed);break;
            case'important':f=f.filter(t=>t.important);break;
            case'quick':f=f.filter(t=>t.quickTask);break;
        }
        if(searchQuery){
            const q=searchQuery.toLowerCase();
            const mids=new Set();
            f.forEach(t=>{
                if(t.text.toLowerCase().includes(q)||getCategoryLabel(t.category).includes(q)){
                    mids.add(t.id);
                    let c=t; while(c.parentId){mids.add(c.parentId);c=todos.find(x=>x.id===c.parentId);if(!c)break;}
                }
            });
            f=f.filter(t=>mids.has(t.id));
        }
        const orderMap={}; manualOrder.forEach((id,i)=>orderMap[id]=i);
        switch(currentSort){
            case'manual':f.sort((a,b)=>(orderMap[a.id]??9999)-(orderMap[b.id]??9999));break;
            case'dueDate':f.sort((a,b)=>{
                const da=a.dueDate||'9999-99-99', db=b.dueDate||'9999-99-99';
                if(da!==db) return da.localeCompare(db);
                return new Date(a.createdAt)-new Date(b.createdAt);
            });break;
            case'newest':f.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));break;
            case'oldest':f.sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt));break;
            case'name':f.sort((a,b)=>a.text.localeCompare(b.text,'ko'));break;
        }
        return f;
    }

    function setFilter(filter) {
        currentFilter=filter; currentCategory=null;
        $$('.nav-item[data-filter]').forEach(b=>b.classList.toggle('active',b.dataset.filter===filter));
        $$('.nav-item[data-category]').forEach(b=>b.classList.remove('active'));
        const titles={all:'전체 할 일',active:'진행중',completed:'완료됨',important:'중요',quick:'⚡ 빠른 할 일'};
        headerTitle.textContent=titles[filter]||'전체 할 일';
        focusNewRow=true; renderTodos();
    }

    function setCategory(category) {
        currentCategory=category; currentFilter='all';
        $$('.nav-item[data-filter]').forEach(b=>b.classList.remove('active'));
        $$('.nav-item[data-category]').forEach(b=>b.classList.toggle('active',b.dataset.category===category));
        headerTitle.textContent=getCategoryLabel(category);
        focusNewRow=true; renderTodos();
    }

    // ==========================================
    // Render — Block editor style
    // ==========================================

    // Cache the current ordered list for Tab reference
    let lastOrderedList = [];

    function buildTodoRowHTML(todo) {
        const dueText = formatDate(todo.dueDate);
        const dueStatus = getDueStatus(todo.dueDate);
        const isDraggable = currentSort === 'manual';
        const hasCat = todo.category && todo.category !== '';
        const depth = getDepth(todo);
        const isChild = depth > 0;
        const childCount = getChildren(todo.id).length;
        const indentPx = depth * 32;
        const isText = todo.type === 'text';

        // Text block — 체크박스/시크바 없는 plain text (textarea)
        if (isText) {
            return `<div class="todo-row text-block"
                         data-id="${todo.id}" data-parent-id="${todo.parentId||''}" data-depth="${depth}">
                        <div class="row-body">
                            <textarea class="text-area" data-id="${todo.id}"
                                      placeholder="텍스트를 입력하세요..."
                                      rows="1" autocomplete="off" spellcheck="false">${escapeHtml(todo.text)}</textarea>
                        </div>
                        <div class="row-actions">
                            <button class="row-action-btn delete" onclick="window.KTodo.deleteTodo('${todo.id}')" title="삭제">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </div>`;
        }

        // Meta tags (category, due, note, quick)
        let metaHtml = '';
        const metaParts = [];
        if (hasCat) metaParts.push(`<span class="row-tag cat-${todo.category}">${getCategoryLabel(todo.category)}</span>`);
        if (todo.quickTask) metaParts.push('<span class="row-tag tag-quick"><i class="fas fa-bolt"></i> 10MIN</span>');
        // 서브태스크는 부모와 같은 마감일이면 뱃지 생략
        const showDue = dueText && !(isChild && todo.dueDate && todo.parentId && todos.find(p => p.id === todo.parentId)?.dueDate === todo.dueDate);
        if (showDue) metaParts.push(`<span class="row-tag tag-due ${dueStatus}"><i class="fas fa-calendar-alt"></i> ${dueText}</span>`);
        if (todo.note) metaParts.push('<span class="row-tag tag-note"><i class="fas fa-sticky-note"></i></span>');
        if (metaParts.length > 0) metaHtml = `<div class="row-meta">${metaParts.join('')}</div>`;

        const hasChildren = childCount > 0;
        const isCollapsed = collapsedIds.has(todo.id);

        return `<div class="todo-row${todo.completed ? ' completed' : ''}${isChild ? ' is-child' : ''}${hasChildren ? ' has-children' : ''}${hasChildren && isCollapsed ? ' collapsed' : ''}"
                     data-id="${todo.id}" data-parent-id="${todo.parentId||''}" data-depth="${depth}"
                     >
                    ${isDraggable ? '<span class="drag-handle"><i class="fas fa-grip-vertical"></i></span>' : ''}
                    ${hasChildren
                        ? `<button class="collapse-toggle" onclick="window.KTodo.toggleCollapse('${todo.id}')" title="${isCollapsed ? '펼치기' : '접기'}"><i class="fas fa-chevron-${isCollapsed ? 'right' : 'down'}"></i><span class="collapse-count">${childCount}</span></button>`
                        : `<label class="row-checkbox${isChild ? ' sub-cb' : ''}">
                            <input type="checkbox" ${todo.completed ? 'checked' : ''}
                                   onchange="window.KTodo.toggleTodo('${todo.id}')">
                            <span class="cb-mark"><i class="fas fa-check"></i></span>
                          </label>`
                    }
                    <div class="row-body">
                        <input type="text" class="row-input" data-id="${todo.id}"
                               value="${escapeHtml(todo.text)}"
                               placeholder="할 일을 입력하세요..."
                               maxlength="200" autocomplete="off" spellcheck="false">
                        ${metaHtml}
                    </div>
                    <div class="row-actions">
                        ${isChild ? `<button class="row-action-btn promote" onclick="window.KTodo.promote('${todo.id}')" title="독립"><i class="fas fa-arrow-up-right-from-square"></i></button>` : ''}
                        <button class="row-star${todo.important ? ' active' : ''}"
                                onclick="window.KTodo.toggleImportant('${todo.id}')" title="중요">
                            <i class="${todo.important ? 'fas' : 'far'} fa-star"></i>
                        </button>
                        <button class="row-action-btn" onclick="window.KTodo.openEditModal('${todo.id}')" title="상세 수정">
                            <i class="fas fa-pen"></i>
                        </button>
                        <button class="row-action-btn delete" onclick="window.KTodo.deleteTodo('${todo.id}')" title="삭제">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>`;
    }

    function buildNewRowHTML() {
        return `<div class="todo-row new-row" id="newRow">
                    <span class="new-row-bullet"><i class="fas fa-plus"></i></span>
                    <div class="row-body">
                        <input type="text" class="row-input new-row-input" id="newRowInput"
                               placeholder="새 할 일을 입력하세요..."
                               maxlength="200" autocomplete="off" spellcheck="false">
                    </div>
                    <div class="new-row-hint">
                        <kbd>Enter</kbd> 추가 · <kbd>Tab</kbd> 서브 · <kbd>Shift+Tab</kbd> 상위
                    </div>
                </div>`;
    }

    // 완료된 top-level 그룹을 하단으로 (자식 포함)
    function sortCompletedToBottom(orderedList) {
        const incGroups = [], doneGroups = [];
        const visited = new Set();
        for (const t of orderedList) {
            if (visited.has(t.id)) continue;
            if (isTopLevel(t)) {
                const children = orderedList.filter(c => c.parentId === t.id);
                // 서브태스크 내에서도 완료된 것은 하단으로
                const activeChildren = children.filter(c => !c.completed);
                const doneChildren = children.filter(c => c.completed);
                const sortedChildren = [...activeChildren, ...doneChildren];
                const group = [t, ...sortedChildren];
                group.forEach(g => visited.add(g.id));
                if (t.completed) doneGroups.push(...group);
                else incGroups.push(...group);
            } else if (!visited.has(t.id)) {
                visited.add(t.id);
                incGroups.push(t);
            }
        }
        return [...incGroups, ...doneGroups];
    }

    // 스크롤 복원용 변수 — renderTodos 전역에서 공유
    let _scrollLock = null;

    function getScrollEl() {
        // 실제 스크롤되는 요소 탐지: html(documentElement) vs .main-content
        const mc = document.querySelector('.main-content');
        if (mc && mc.scrollHeight > mc.clientHeight) return mc;
        return document.documentElement;
    }

    function renderTodos() {
        // 스크롤 위치 저장 (동기)
        const sc = getScrollEl();
        const saved = sc.scrollTop;
        _scrollLock = { el: sc, top: saved };

        const filtered = getFilteredTodos();
        let ordered = buildOrderedList(filtered);
        lastOrderedList = ordered;

        // 미완료만 분리 (완료 필터일 때는 전부 표시)
        // 서브태스크는 부모가 완료될 때까지 상단에 유지
        let activeOrdered;
        if (currentFilter === 'completed') {
            activeOrdered = ordered;
        } else {
            activeOrdered = ordered.filter(t => {
                if (!t.completed) return true; // 미완료 → 항상 표시
                // 완료된 항목: 서브태스크면 최상위 부모가 완료되어야 하단으로 이동
                if (t.parentId && !isAncestorCompleted(t)) return true;
                return false;
            });
        }

        // 접힌 부모의 자식 숨기기
        const visibleOrdered = activeOrdered.filter(t => {
            if (!t.parentId) return true;
            let pid = t.parentId;
            while (pid) {
                if (collapsedIds.has(pid)) return false;
                const parent = todos.find(p => p.id === pid);
                pid = parent ? parent.parentId : null;
            }
            return true;
        });

        // Quick tasks
        if (currentFilter === 'quick') {
            quickTaskSection.style.display = 'none';
            normalSectionHeader.style.display = 'none';
            emptyState.classList.toggle('show', visibleOrdered.length === 0);
            todoList.innerHTML = visibleOrdered.map(buildTodoRowHTML).join('') + buildNewRowHTML();
            sc.scrollTop = saved;
            bindAllRowEvents(todoList);
            if (currentSort === 'manual') initDragAndDrop(todoList);
            renderDoneSection();
            restoreFocus();
            return;
        }

        const quickTasks = visibleOrdered.filter(t => t.quickTask && !t.completed && isTopLevel(t));
        const qids = new Set(quickTasks.map(t => t.id));
        const qwc = []; for (const t of visibleOrdered) { if (qids.has(t.id) || qids.has(t.parentId)) qwc.push(t); }
        const qwcIds = new Set(qwc.map(t => t.id));
        const normalTasks = visibleOrdered.filter(t => !qwcIds.has(t.id));

        if (qwc.length > 0) {
            quickTaskSection.style.display = 'block';
            quickTaskCount.textContent = quickTasks.length;
            quickTaskList.innerHTML = qwc.map(buildTodoRowHTML).join('');
            bindAllRowEvents(quickTaskList);
            if (currentSort === 'manual') initDragAndDrop(quickTaskList);
        } else { quickTaskSection.style.display = 'none'; }

        normalSectionHeader.style.display = (qwc.length > 0 && normalTasks.length > 0) ? 'block' : 'none';

        emptyState.classList.toggle('show', visibleOrdered.length === 0);
        todoList.innerHTML = normalTasks.map(buildTodoRowHTML).join('') + buildNewRowHTML();
        sc.scrollTop = saved;
        bindAllRowEvents(todoList);
        if (currentSort === 'manual') initDragAndDrop(todoList);

        if (animateNewId) {
            const newRow = todoList.querySelector(`.todo-row[data-id="${animateNewId}"]`);
            if (newRow) newRow.classList.add('animate-in');
            animateNewId = null;
        }

        // 완료 섹션 (완료 필터 아닐 때만)
        if (currentFilter !== 'completed') {
            renderDoneSection();
        } else {
            const ds = $('#doneSection');
            if (ds) ds.style.display = 'none';
        }

        restoreFocus();
    }

    function restoreFocus() {
        setTimeout(() => {
            // 포커스 복원
            if (focusTargetId) {
                const inp = document.querySelector(`.row-input[data-id="${focusTargetId}"]`)
                           || document.querySelector(`.text-area[data-id="${focusTargetId}"]`);
                if (inp) {
                    inp.focus({ preventScroll: true });
                    const len = inp.value.length;
                    inp.setSelectionRange(len, len);
                }
                focusTargetId = null;
            } else if (focusNewRow) {
                const nr = document.getElementById('newRowInput');
                if (nr) nr.focus({ preventScroll: true });
                focusNewRow = false;
            }
            // 포커스 후 스크롤 다시 강제 복원
            if (_scrollLock) {
                _scrollLock.el.scrollTop = _scrollLock.top;
                _scrollLock = null;
            }
        }, 10);
    }

    // ==========================================
    // Auto-replace shortcuts (e.g. -> → →)
    // ==========================================
    const AUTO_REPLACE = [
        { from: '->', to: '→' },
        { from: '<-', to: '←' },
        { from: '=>', to: '⇒' },
    ];

    function autoReplace(el) {
        const start = el.selectionStart;
        let val = el.value;
        for (const r of AUTO_REPLACE) {
            const idx = val.lastIndexOf(r.from, start);
            if (idx >= 0 && idx + r.from.length === start) {
                el.value = val.slice(0, idx) + r.to + val.slice(start);
                el.selectionStart = el.selectionEnd = idx + r.to.length;
                return;
            }
        }
    }

    // ==========================================
    // Row Event Binding
    // ==========================================
    function bindAllRowEvents(container) {
        // Existing todo row inputs
        container.querySelectorAll('.row-input[data-id]').forEach(inp => {
            inp.addEventListener('keydown', handleRowKeydown);
            inp.addEventListener('blur', handleRowBlur);
            inp.addEventListener('input', () => autoReplace(inp));
        });

        // Text block textareas
        container.querySelectorAll('.text-area[data-id]').forEach(ta => {
            autoResizeTextarea(ta);
            ta.addEventListener('input', () => { autoResizeTextarea(ta); autoReplace(ta); });
            ta.addEventListener('keydown', handleTextAreaKeydown);
            ta.addEventListener('blur', handleRowBlur);
        });

        // New row input
        const newInp = container.querySelector('#newRowInput');
        if (newInp) {
            newInp.addEventListener('keydown', handleNewRowKeydown);
            newInp.addEventListener('input', () => autoReplace(newInp));
        }
    }

    // --- Existing row key handling ---
    let blurSaveTimer = null;
    let suppressBlurDelete = false; // Tab/Shift+Tab 시 blur 삭제 방지

    function handleRowKeydown(e) {
        const inp = e.target;
        const id = inp.dataset.id;
        const todo = todos.find(t => t.id === id);
        if (!todo) return;

        if (e.key === 'Enter') {
            e.preventDefault();
            const newText = inp.value.trim();

            // 빈 할일 행에서 Enter → 텍스트 블록으로 전환
            if (newText === '' && todo.text === '' && todo.type === 'todo') {
                suppressBlurDelete = true;
                setTimeout(() => { suppressBlurDelete = false; }, 300);
                todo.type = 'text';
                saveTodos();
                focusTargetId = id;
                renderTodos();
                updateStats();
                return;
            }

            // 빈 텍스트 블록에서 Enter → 행 삭제
            if (newText === '' && todo.text === '' && todo.type === 'text') {
                suppressBlurDelete = true;
                setTimeout(() => { suppressBlurDelete = false; }, 300);
                const desc = getDescendantIds(id);
                const remove = new Set([id, ...desc]);
                todos = todos.filter(t => !remove.has(t.id));
                manualOrder = manualOrder.filter(o => !remove.has(o));
                saveTodos();
                focusNewRow = true;
                renderTodos();
                updateStats();
                return;
            }

            // Save current text
            if (newText !== todo.text) {
                todo.text = newText;
                saveTodos();
            }

            const cursorPos = inp.selectionStart;

            if (cursorPos === 0 && newText.length > 0) {
                // 커서가 맨 앞 → 현재 항목 "위에" 빈 행 생성
                const newTodo = createTodo('', todo.parentId);
                newTodo.dueDate = todo.dueDate; // 마감일 상속
                const currentIdx = manualOrder.indexOf(id);
                const newIdx = manualOrder.indexOf(newTodo.id);
                manualOrder.splice(newIdx, 1);
                manualOrder.splice(currentIdx, 0, newTodo.id);
                saveTodos();
                focusTargetId = newTodo.id; // 새로 생긴 항목에 포커스
            } else {
                // 커서가 중간/끝 → 현재 항목 "아래에" 새 행 생성
                const newTodo = createTodo('', todo.parentId);
                newTodo.dueDate = todo.dueDate; // 마감일 상속
                const currentIdx = manualOrder.indexOf(id);
                const descendants = getDescendantIds(id);
                let insertAfterIdx = currentIdx;
                for (const did of descendants) {
                    const di = manualOrder.indexOf(did);
                    if (di > insertAfterIdx) insertAfterIdx = di;
                }
                const newIdx = manualOrder.indexOf(newTodo.id);
                manualOrder.splice(newIdx, 1);
                manualOrder.splice(insertAfterIdx + 1, 0, newTodo.id);
                saveTodos();
                focusTargetId = newTodo.id; // 새 항목에 포커스
            }
            renderTodos();
            updateStats();
            return;
        }

        if (e.key === 'Tab' && !e.shiftKey) {
            e.preventDefault();
            clearTimeout(blurSaveTimer);
            suppressBlurDelete = true;
            setTimeout(() => { suppressBlurDelete = false; }, 300);
            if (todo.parentId) return; // already a child, max 1 level
            const ordered = lastOrderedList;
            const idx = ordered.findIndex(t => t.id === id);
            let parentCandidate = null;
            for (let i = idx - 1; i >= 0; i--) {
                if (!ordered[i].parentId) {
                    parentCandidate = ordered[i];
                    break;
                }
            }
            if (parentCandidate) {
                todo.parentId = parentCandidate.id;
                saveTodos();
                focusTargetId = id;
                renderTodos();
                updateStats();
            }
            return;
        }

        if (e.key === 'Tab' && e.shiftKey) {
            e.preventDefault();
            clearTimeout(blurSaveTimer);
            suppressBlurDelete = true;
            setTimeout(() => { suppressBlurDelete = false; }, 300);
            if (todo.parentId) {
                todo.parentId = null;
                saveTodos();
                focusTargetId = id;
                renderTodos();
                updateStats();
            }
            return;
        }

        if (e.key === 'Backspace' && inp.value === '') {
            e.preventDefault();
            // Delete this empty todo
            // Focus the previous item
            const ordered = lastOrderedList;
            const idx = ordered.findIndex(t => t.id === id);
            const prevTodo = idx > 0 ? ordered[idx - 1] : null;
            
            const desc = getDescendantIds(id);
            const remove = new Set([id, ...desc]);
            todos = todos.filter(t => !remove.has(t.id));
            manualOrder = manualOrder.filter(o => !remove.has(o));
            saveTodos();

            if (prevTodo) focusTargetId = prevTodo.id;
            else focusNewRow = true;
            renderTodos();
            updateStats();
            return;
        }

        if (e.key === 'ArrowUp') {
            e.preventDefault();
            const ordered = lastOrderedList;
            const idx = ordered.findIndex(t => t.id === id);
            if (idx > 0) {
                focusTargetId = ordered[idx - 1].id;
                renderTodos();
            }
            return;
        }

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            const ordered = lastOrderedList;
            const idx = ordered.findIndex(t => t.id === id);
            if (idx < ordered.length - 1) {
                focusTargetId = ordered[idx + 1].id;
                renderTodos();
            } else {
                // Focus new row
                const nr = document.getElementById('newRowInput');
                if (nr) nr.focus();
            }
            return;
        }

        if (e.key === 'Escape') {
            e.preventDefault();
            inp.blur();
        }
    }

    function handleRowBlur(e) {
        const inp = e.target;
        const id = inp.dataset.id;
        const todo = todos.find(t => t.id === id);
        if (!todo) return;

        clearTimeout(blurSaveTimer);
        blurSaveTimer = setTimeout(() => {
            const currentTodo = todos.find(t => t.id === id);
            if (!currentTodo) return;
            if (suppressBlurDelete) return;
            const newText = inp.value.trim();
            if (newText === '' && currentTodo.text === '') {
                const desc = getDescendantIds(id);
                const remove = new Set([id, ...desc]);
                todos = todos.filter(t => !remove.has(t.id));
                manualOrder = manualOrder.filter(o => !remove.has(o));
                saveTodos(); renderTodos(); updateStats();
            } else if (newText !== currentTodo.text) {
                currentTodo.text = newText;
                saveTodos();
            }
        }, 150);
    }

    // --- Textarea auto-resize ---
    function autoResizeTextarea(ta) {
        ta.style.height = 'auto';
        ta.style.height = ta.scrollHeight + 'px';
    }

    // --- Text block (textarea) key handling ---
    function handleTextAreaKeydown(e) {
        const ta = e.target;
        const id = ta.dataset.id;
        const todo = todos.find(t => t.id === id);
        if (!todo) return;

        // Enter → 줄바꿈 (기본 동작 그대로)
        // 아무 처리 안 하면 textarea에서 Enter = 줄바꿈

        // Backspace on completely empty → 삭제하고 위 행으로
        if (e.key === 'Backspace' && ta.value === '') {
            e.preventDefault();
            suppressBlurDelete = true;
            setTimeout(() => { suppressBlurDelete = false; }, 300);
            const ordered = lastOrderedList;
            const idx = ordered.findIndex(t => t.id === id);
            const prevTodo = idx > 0 ? ordered[idx - 1] : null;

            const desc = getDescendantIds(id);
            const remove = new Set([id, ...desc]);
            todos = todos.filter(t => !remove.has(t.id));
            manualOrder = manualOrder.filter(o => !remove.has(o));
            saveTodos();

            if (prevTodo) focusTargetId = prevTodo.id;
            else focusNewRow = true;
            renderTodos();
            updateStats();
            return;
        }

        if (e.key === 'Escape') {
            e.preventDefault();
            ta.blur();
        }
    }

    // --- New row key handling ---
    function handleNewRowKeydown(e) {
        const inp = e.target;

        if (e.key === 'Enter') {
            e.preventDefault();
            const text = inp.value.trim();
            if (!text) return;

            const newTodo = createTodo(text, null);
            // Focus a fresh new row
            focusNewRow = true;
            renderTodos();
            updateStats();
            return;
        }

        if (e.key === 'Tab' && !e.shiftKey) {
            e.preventDefault();
            const text = inp.value.trim();
            if (!text) return;

            // Find the last top-level todo in the current list
            const ordered = lastOrderedList;
            // Get the last item that is top-level
            let lastTopLevel = null;
            for (let i = ordered.length - 1; i >= 0; i--) {
                if (!ordered[i].parentId) { lastTopLevel = ordered[i]; break; }
            }
            if (lastTopLevel) {
                const newTodo = createTodo(text, lastTopLevel.id);
                focusNewRow = true;
                renderTodos();
                updateStats();
            }
            return;
        }

        if (e.key === 'ArrowUp') {
            e.preventDefault();
            const ordered = lastOrderedList;
            if (ordered.length > 0) {
                focusTargetId = ordered[ordered.length - 1].id;
                renderTodos();
            }
            return;
        }

        if (e.key === 'Escape') {
            e.preventDefault();
            inp.value = '';
            inp.blur();
        }
    }

    // ==========================================
    // Drag & Drop
    // ==========================================
    function initDragAndDrop(container) {
        if (!container) return;
        const items = container.querySelectorAll('.todo-row');
        items.forEach(item => {
            // 드래그 이벤트는 행에서 받지만, 시작은 핸들에서만
            item.addEventListener('dragover', handleDragOver);
            item.addEventListener('dragenter', handleDragEnter);
            item.addEventListener('dragleave', handleDragLeave);
            item.addEventListener('drop', handleDrop);
            item.addEventListener('dragend', handleDragEnd);

            const h = item.querySelector('.drag-handle');
            if (h) {
                // 마우스: 핸들 mousedown → 행 draggable 활성화
                h.addEventListener('mousedown', () => {
                    item.setAttribute('draggable', 'true');
                });
                // 터치: 기존 터치 드래그
                h.addEventListener('touchstart', handleTouchStart, {passive: false});
            }
            item.addEventListener('dragstart', handleDragStart);
        });
        // mouseup/dragend 시 draggable 해제 (텍스트 선택 복원)
        document.addEventListener('mouseup', clearAllDraggable);
    }

    function clearAllDraggable() {
        document.querySelectorAll('.todo-row[draggable]').forEach(el => {
            el.removeAttribute('draggable');
        });
    }

    function handleDragStart(e) {
        draggedId = this.dataset.id;
        this.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', this.dataset.id);
    }

    function handleDragEnd() {
        this.classList.remove('dragging');
        this.removeAttribute('draggable');
        document.querySelectorAll('.todo-row').forEach(el =>
            el.classList.remove('drag-over', 'drag-over-child', 'drag-over-above', 'drag-over-below'));
        draggedId = null;
    }

    function handleDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (this.dataset.id === draggedId) return;
        const rect = this.getBoundingClientRect(), y = e.clientY - rect.top, h = rect.height;
        const d = parseInt(this.dataset.depth) || 0;
        this.classList.remove('drag-over-above', 'drag-over-child', 'drag-over-below');
        if (y < h * 0.4) this.classList.add('drag-over-above');
        else if (y > h * 0.6) this.classList.add('drag-over-below');
        else this.classList.add(d === 0 ? 'drag-over-child' : 'drag-over-below');
    }

    function handleDragEnter(e) { e.preventDefault(); }
    function handleDragLeave() { this.classList.remove('drag-over', 'drag-over-child', 'drag-over-above', 'drag-over-below'); }

    function handleDrop(e) {
        e.preventDefault();
        const fromId = draggedId, toId = this.dataset.id;
        if (!fromId || fromId === toId) {
            this.classList.remove('drag-over', 'drag-over-child', 'drag-over-above', 'drag-over-below');
            return;
        }
        const rect = this.getBoundingClientRect(), y = e.clientY - rect.top, h = rect.height;
        const td = parseInt(this.dataset.depth) || 0;
        const fromTodo = todos.find(t => t.id === fromId);
        if (y >= h * 0.4 && y <= h * 0.6 && td === 0) {
            setParent(fromId, toId);
            showToast('서브 할 일로 변경됨', 'info');
        } else {
            const tt = todos.find(t => t.id === toId);
            if (fromTodo && tt) fromTodo.parentId = tt.parentId;
            const fi = manualOrder.indexOf(fromId);
            if (fi !== -1) {
                manualOrder.splice(fi, 1);
                if (y >= h * 0.6) manualOrder.splice(manualOrder.indexOf(toId) + 1, 0, fromId);
                else manualOrder.splice(manualOrder.indexOf(toId), 0, fromId);
            }
            saveTodos(); renderTodos(); updateStats();
        }
        this.classList.remove('drag-over', 'drag-over-child', 'drag-over-above', 'drag-over-below');
    }

    // Touch drag
    let touchItem = null, touchClone = null, touchStartY = 0;
    function handleTouchStart(e) {
        const item = e.target.closest('.todo-row'); if (!item) return;
        e.preventDefault(); touchItem = item; draggedId = item.dataset.id; touchStartY = e.touches[0].clientY;
        touchClone = item.cloneNode(true);
        touchClone.style.cssText = `position:fixed;top:${item.getBoundingClientRect().top}px;left:${item.getBoundingClientRect().left}px;width:${item.offsetWidth}px;z-index:9999;opacity:0.85;pointer-events:none;transition:none;box-shadow:0 8px 32px rgba(0,0,0,0.12);transform:scale(1.02);`;
        document.body.appendChild(touchClone); item.classList.add('dragging');
        document.addEventListener('touchmove', handleTouchMove, {passive: false});
        document.addEventListener('touchend', handleTouchEnd);
    }
    function handleTouchMove(e) {
        e.preventDefault(); const t = e.touches[0], dy = t.clientY - touchStartY;
        if (touchClone) touchClone.style.top = (touchItem.getBoundingClientRect().top + dy) + 'px';
        if (touchClone) touchClone.style.display = 'none';
        const eb = document.elementFromPoint(t.clientX, t.clientY);
        if (touchClone) touchClone.style.display = '';
        document.querySelectorAll('.todo-row').forEach(el => el.classList.remove('drag-over', 'drag-over-child', 'drag-over-above', 'drag-over-below'));
        const ti = eb?.closest('.todo-row');
        if (ti && ti.dataset.id !== draggedId) {
            const r = ti.getBoundingClientRect(), y = t.clientY - r.top, h = r.height, d = parseInt(ti.dataset.depth) || 0;
            if (y < h * 0.4) ti.classList.add('drag-over-above');
            else if (y > h * 0.6) ti.classList.add('drag-over-below');
            else ti.classList.add(d === 0 ? 'drag-over-child' : 'drag-over-below');
        }
    }
    function handleTouchEnd(e) {
        document.removeEventListener('touchmove', handleTouchMove);
        document.removeEventListener('touchend', handleTouchEnd);
        if (touchClone) { touchClone.remove(); touchClone = null; }
        if (touchItem) touchItem.classList.remove('dragging');
        const t = e.changedTouches[0], eb = document.elementFromPoint(t.clientX, t.clientY), ti = eb?.closest('.todo-row');
        if (ti && ti.dataset.id !== draggedId) {
            const fid = draggedId, tid = ti.dataset.id, r = ti.getBoundingClientRect(), y = t.clientY - r.top, h = r.height, d = parseInt(ti.dataset.depth) || 0;
            const ft = todos.find(t => t.id === fid);
            if (y >= h * 0.4 && y <= h * 0.6 && d === 0) {
                setParent(fid, tid); showToast('서브 할 일로 변경됨', 'info');
            } else {
                const tt = todos.find(t => t.id === tid); if (ft && tt) ft.parentId = tt.parentId;
                const fi = manualOrder.indexOf(fid); if (fi !== -1) {
                    manualOrder.splice(fi, 1);
                    if (y >= h * 0.6) manualOrder.splice(manualOrder.indexOf(tid) + 1, 0, fid);
                    else manualOrder.splice(manualOrder.indexOf(tid), 0, fid);
                }
                saveTodos(); renderTodos(); updateStats();
            }
        }
        document.querySelectorAll('.todo-row').forEach(el => el.classList.remove('drag-over', 'drag-over-child', 'drag-over-above', 'drag-over-below'));
        touchItem = null; draggedId = null;
    }

    // ==========================================
    // Stats
    // ==========================================
    function updateStats() {
        const todoItems = todos.filter(t => t.type !== 'text');
        const total = todoItems.length, completed = todoItems.filter(t => t.completed).length, pending = total - completed;
        const important = todoItems.filter(t => t.important).length, quick = todoItems.filter(t => t.quickTask && !t.completed).length;
        const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
        totalTasks.textContent = total; completedTasks.textContent = completed; pendingTasks.textContent = pending;
        progressPercent.textContent = pct + '%'; progressFill.style.width = pct + '%';
        badgeAll.textContent = total; badgeActive.textContent = pending;
        badgeCompleted.textContent = completed; badgeImportant.textContent = important; badgeQuick.textContent = quick;
    }

    function updateHeaderDate() {
        const now = new Date();
        headerDate.textContent = now.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
    }

    // ==========================================
    // Toast
    // ==========================================
    function showToast(message, type = 'info') {
        const c = $('#toastContainer'), t = document.createElement('div');
        t.className = `toast ${type}`; t.innerHTML = `<span class="toast-dot"></span><span>${message}</span>`;
        c.appendChild(t); setTimeout(() => { t.classList.add('removing'); setTimeout(() => t.remove(), 250); }, 2200);
    }

    // ==========================================
    // Events
    // ==========================================
    // ==========================================
    // Done Section (완료 캘린더)
    // ==========================================
    let doneCalYear, doneCalMonth, doneSelectedDate = null;
    let doneSectionOpen = true;

    function initDoneSection() {
        const now = new Date();
        doneCalYear = now.getFullYear();
        doneCalMonth = now.getMonth();
        doneSelectedDate = formatDateKey(now);

        const toggle = $('#doneSectionToggle');
        const body = $('#doneSectionBody');
        const chevron = $('#doneChevron');
        if (toggle) {
            toggle.addEventListener('click', () => {
                doneSectionOpen = !doneSectionOpen;
                body.style.display = doneSectionOpen ? 'block' : 'none';
                chevron.style.transform = doneSectionOpen ? 'rotate(0)' : 'rotate(-90deg)';
            });
        }
        const prev = $('#doneCalPrev');
        const next = $('#doneCalNext');
        if (prev) prev.addEventListener('click', () => { doneCalMonth--; if (doneCalMonth < 0) { doneCalMonth = 11; doneCalYear--; } renderDoneCal(); });
        if (next) next.addEventListener('click', () => { doneCalMonth++; if (doneCalMonth > 11) { doneCalMonth = 0; doneCalYear++; } renderDoneCal(); });
    }

    function getCompletedForDate(dateKey) {
        return todos.filter(t => {
            if (!isDoneForCalendar(t)) return false;
            const cKey = formatDateKey(new Date(t.completedAt));
            return cKey === dateKey;
        });
    }

    function renderDoneCal() {
        const monthEl = $('#doneCalMonth');
        const daysEl = $('#doneCalDays');
        if (!monthEl || !daysEl) return;

        monthEl.textContent = `${doneCalYear}년 ${doneCalMonth + 1}월`;

        const firstDay = new Date(doneCalYear, doneCalMonth, 1).getDay();
        const daysInMonth = new Date(doneCalYear, doneCalMonth + 1, 0).getDate();
        const todayKey = formatDateKey(new Date());

        // 이번 달 완료 건수 미리 계산
        const monthCounts = {};
        todos.forEach(t => {
            if (!isDoneForCalendar(t)) return;
            const d = new Date(t.completedAt);
            if (d.getFullYear() === doneCalYear && d.getMonth() === doneCalMonth) {
                const k = formatDateKey(d);
                monthCounts[k] = (monthCounts[k] || 0) + 1;
            }
        });

        let html = '';
        // 이전 달 빈칸
        const prevDays = new Date(doneCalYear, doneCalMonth, 0).getDate();
        for (let i = firstDay - 1; i >= 0; i--) {
            html += `<div class="done-cal-day other">${prevDays - i}</div>`;
        }
        // 이번 달
        for (let d = 1; d <= daysInMonth; d++) {
            const key = `${doneCalYear}-${String(doneCalMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
            const isToday = key === todayKey ? ' today' : '';
            const isSelected = key === doneSelectedDate ? ' selected' : '';
            const count = monthCounts[key] || 0;
            const hasDone = count > 0 ? ' has-done' : '';
            html += `<div class="done-cal-day${isToday}${isSelected}${hasDone}" data-date="${key}">
                <span class="done-cal-num">${d}</span>
                ${count > 0 ? `<span class="done-cal-dot">${count}</span>` : ''}
            </div>`;
        }
        // 다음 달 빈칸
        const totalCells = firstDay + daysInMonth;
        const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
        for (let i = 1; i <= remaining; i++) {
            html += `<div class="done-cal-day other">${i}</div>`;
        }

        daysEl.innerHTML = html;

        // 날짜 클릭
        daysEl.querySelectorAll('.done-cal-day:not(.other)').forEach(el => {
            el.addEventListener('click', () => {
                doneSelectedDate = el.dataset.date;
                renderDoneCal();
                renderDoneDayList();
            });
        });

        renderDoneDayList();
    }

    function renderDoneDayList() {
        const titleEl = $('#doneDayTitle');
        const countEl = $('#doneDayCount');
        const itemsEl = $('#doneDayItems');
        if (!titleEl || !itemsEl) return;

        if (!doneSelectedDate) {
            titleEl.textContent = '날짜를 선택하세요';
            countEl.textContent = '';
            itemsEl.innerHTML = '<div class="done-day-empty"><i class="fas fa-calendar-check"></i><p>캘린더에서 날짜를 클릭하세요</p></div>';
            return;
        }

        const d = new Date(doneSelectedDate + 'T00:00:00');
        titleEl.textContent = d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });

        const items = getCompletedForDate(doneSelectedDate);
        countEl.textContent = items.length > 0 ? `${items.length}개 완료` : '';

        if (items.length === 0) {
            itemsEl.innerHTML = '<div class="done-day-empty"><i class="fas fa-face-smile"></i><p>이 날 완료한 할 일이 없습니다</p></div>';
            return;
        }

        itemsEl.innerHTML = items.map(t => {
            const catHtml = t.category ? `<span class="done-item-cat ${t.category}">${getCategoryLabel(t.category)}</span>` : '';
            const isChild = !isTopLevel(t);
            return `<div class="done-item${isChild ? ' sub' : ''}">
                <i class="fas fa-circle-check done-item-icon"></i>
                ${catHtml}
                <span class="done-item-text">${escapeHtml(t.text || '(미입력)')}</span>
            </div>`;
        }).join('');
    }

    function renderDoneSection() {
        const ds = $('#doneSection');
        if (!ds) return;

        const completedCount = todos.filter(t => isDoneForCalendar(t)).length;
        const countEl = $('#doneCount');
        if (countEl) countEl.textContent = completedCount;

        ds.style.display = 'block';
        renderDoneCal();
    }

    // ==========================================
    // Event Listeners
    // ==========================================
    function initEventListeners() {
        // Global keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            // Ctrl/Cmd+N — focus new row input
            if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
                e.preventDefault();
                if (currentView !== 'todo') switchView('todo');
                const nr = document.getElementById('newRowInput');
                if (nr) nr.focus();
            }
            // Escape
            if (e.key === 'Escape') {
                if (editModal.classList.contains('show')) closeEditModal();
                else if (searchInput === document.activeElement) {
                    searchInput.value = ''; searchQuery = ''; renderTodos(); searchInput.blur();
                }
            }
            // Ctrl/Cmd+F — focus search
            if ((e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); searchInput.focus(); }

            // Enter (not in an input/textarea/modal) — focus new row
            if (e.key === 'Enter' && currentView === 'todo') {
                const tag = document.activeElement.tagName.toLowerCase();
                const isInModal = editModal.classList.contains('show');
                const isInBugInput = document.activeElement.classList.contains('bug-add-input');
                if (tag !== 'input' && tag !== 'textarea' && !isInModal && !isInBugInput) {
                    e.preventDefault();
                    const nr = document.getElementById('newRowInput');
                    if (nr) nr.focus();
                }
            }
        });

        editQuickToggle.addEventListener('click', () => editQuickToggle.classList.toggle('active'));

        $$('.nav-item[data-filter]').forEach(btn => {
            btn.addEventListener('click', () => { if (currentView !== 'todo') switchView('todo'); setFilter(btn.dataset.filter); closeSidebarMobile(); });
        });
        $$('.nav-item[data-category]').forEach(btn => {
            btn.addEventListener('click', () => {
                if (currentView !== 'todo') switchView('todo');
                if (currentCategory === btn.dataset.category) {
                    currentCategory = null; btn.classList.remove('active');
                    headerTitle.textContent = '전체 할 일'; setFilter('all');
                } else setCategory(btn.dataset.category);
                closeSidebarMobile();
            });
        });

        searchInput.addEventListener('input', (e) => { searchQuery = e.target.value.trim(); renderTodos(); });
        sortBtn.addEventListener('click', (e) => { e.stopPropagation(); sortDropdown.classList.toggle('show'); });
        $$('#sortDropdown button').forEach(btn => {
            btn.addEventListener('click', () => { currentSort = btn.dataset.sort; saveSort(); sortDropdown.classList.remove('show'); renderTodos(); showToast(`정렬: ${btn.textContent}`, 'info'); });
        });
        document.addEventListener('click', () => sortDropdown.classList.remove('show'));
        menuToggle.addEventListener('click', () => { sidebar.classList.toggle('open'); toggleOverlay(sidebar.classList.contains('open')); });

        // Mobile search toggle
        const mobileSearchToggle = $('#mobileSearchToggle');
        const searchBox = $('#searchBox');
        if (mobileSearchToggle && searchBox) {
            mobileSearchToggle.addEventListener('click', () => {
                searchBox.classList.toggle('mobile-open');
                mobileSearchToggle.classList.toggle('active');
                if (searchBox.classList.contains('mobile-open')) {
                    searchInput.focus();
                } else {
                    searchInput.value = ''; searchQuery = ''; renderTodos(); searchInput.blur();
                }
            });
        }

        clearCompletedBtn.addEventListener('click', clearCompleted);
        modalClose.addEventListener('click', closeEditModal);
        modalCancel.addEventListener('click', closeEditModal);
        modalSave.addEventListener('click', saveEdit);
        editModal.addEventListener('click', (e) => { if (e.target === editModal) closeEditModal(); });
        editTodoInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveEdit(); });
    }

    // ==========================================
    // Mobile Sidebar
    // ==========================================
    let overlay = null;
    function toggleOverlay(show) {
        if (show) {
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.className = 'sidebar-overlay show';
                overlay.addEventListener('click', closeSidebarMobile);
                document.body.appendChild(overlay);
            } else overlay.classList.add('show');
        } else if (overlay) overlay.classList.remove('show');
    }
    function closeSidebarMobile() { sidebar.classList.remove('open'); toggleOverlay(false); }

    // ==========================================
    // View Switching
    // ==========================================
    let currentView = 'home';
    const todoView = $('#todoView'), bugView = $('#bugView'), homeView = $('#homeView'), memoView = $('#memoView');
    const navBugTracker = $('#navBugTracker'), navHome = $('#navHome'), navMemo = $('#navMemo');

    function switchView(view) {
        currentView = view;
        // Hide all
        homeView.style.display = 'none';
        todoView.style.display = 'none';
        bugView.style.display = 'none';
        memoView.style.display = 'none';
        navHome.classList.remove('active');
        navBugTracker.classList.remove('active');
        navMemo.classList.remove('active');
        $$('.nav-item[data-filter]').forEach(b => b.classList.remove('active'));
        $$('.nav-item[data-category]').forEach(b => b.classList.remove('active'));

        if (view === 'home') {
            homeView.style.display = 'block';
            navHome.classList.add('active');
            renderCalendar();
            renderHomeMemos();
        } else if (view === 'bugs') {
            bugView.style.display = 'block';
            navBugTracker.classList.add('active');
            renderBugs();
        } else if (view === 'memo') {
            memoView.style.display = 'block';
            navMemo.classList.add('active');
            renderMemos();
        } else {
            todoView.style.display = 'block';
            setFilter(currentFilter);
        }
        closeSidebarMobile();
        syncMobileTab();
    }    // ==========================================
    // Bug Tracker
    // ==========================================
    const BUG_STORAGE_KEY = 'kyongmin_bugs_data';
    let bugs = { home: [], test: [] };
    const bugListHome = $('#bugListHome'), bugListTest = $('#bugListTest');
    const bugAddHome = $('#bugAddHome'), bugAddTest = $('#bugAddTest');
    const bugHomeDone = $('#bugHomeDone'), bugHomeTotal = $('#bugHomeTotal'), bugHomeFill = $('#bugHomeFill');
    const bugTestDone = $('#bugTestDone'), bugTestTotal = $('#bugTestTotal'), bugTestFill = $('#bugTestFill');
    const badgeBugs = $('#badgeBugs'), bugMenuToggle = $('#bugMenuToggle');

    function loadBugs() { try { const d = localStorage.getItem(BUG_STORAGE_KEY); if (d) bugs = JSON.parse(d); if (!bugs.home) bugs.home = []; if (!bugs.test) bugs.test = []; } catch(e) { bugs = { home: [], test: [] }; } }
    function saveBugs() { try { localStorage.setItem(BUG_STORAGE_KEY, JSON.stringify(bugs)); } catch(e) { showToast('저장 중 오류', 'error'); } }

    function addBug(s, text) { text = text.trim(); if (!text) return; bugs[s].push({ id: generateId(), text, done: false, createdAt: new Date().toISOString() }); saveBugs(); renderBugs(); }
    function toggleBug(s, id) { const b = bugs[s].find(b => b.id === id); if (!b) return; b.done = !b.done; saveBugs(); renderBugs(); if (b.done) showToast('해결 완료!', 'success'); }
    function deleteBug(s, id) { bugs[s] = bugs[s].filter(b => b.id !== id); saveBugs(); renderBugs(); showToast('삭제됨', 'info'); }

    function buildBugItemHTML(bug, s) {
        return `<div class="bug-item ${bug.done ? 'done' : ''}" data-id="${bug.id}" data-section="${s}">
            <label class="bug-checkbox"><input type="checkbox" ${bug.done ? 'checked' : ''} onchange="window.KTodo.toggleBug('${s}','${bug.id}')"><span class="bug-checkmark"><i class="fas fa-check"></i></span></label>
            <input type="text" class="bug-text-input" data-id="${bug.id}" data-section="${s}"
                   value="${escapeHtml(bug.text)}" maxlength="200" autocomplete="off" spellcheck="false">
            <button class="bug-delete" onclick="window.KTodo.deleteBug('${s}','${bug.id}')" title="삭제"><i class="fas fa-xmark"></i></button>
        </div>`;
    }

    function renderBugs() {
        const hi = bugs.home || [], hd = hi.filter(b => b.done).length;
        const hiSorted = [...hi.filter(b => !b.done), ...hi.filter(b => b.done)];
        bugListHome.innerHTML = hiSorted.map(b => buildBugItemHTML(b, 'home')).join('');
        bugHomeDone.textContent = hd; bugHomeTotal.textContent = hi.length;
        bugHomeFill.style.width = (hi.length > 0 ? Math.round((hd / hi.length) * 100) : 0) + '%';
        const ti = bugs.test || [], td = ti.filter(b => b.done).length;
        const tiSorted = [...ti.filter(b => !b.done), ...ti.filter(b => b.done)];
        bugListTest.innerHTML = tiSorted.map(b => buildBugItemHTML(b, 'test')).join('');
        bugTestDone.textContent = td; bugTestTotal.textContent = ti.length;
        bugTestFill.style.width = (ti.length > 0 ? Math.round((td / ti.length) * 100) : 0) + '%';
        badgeBugs.textContent = hi.filter(b => !b.done).length + ti.filter(b => !b.done).length;
        bindBugInputEvents();
    }

    function bindBugInputEvents() {
        document.querySelectorAll('.bug-text-input').forEach(inp => {
            inp.addEventListener('blur', () => {
                const s = inp.dataset.section;
                const id = inp.dataset.id;
                const bug = bugs[s].find(b => b.id === id);
                if (!bug) return;
                const newText = inp.value.trim();
                if (newText && newText !== bug.text) {
                    bug.text = newText;
                    saveBugs();
                } else if (!newText) {
                    inp.value = bug.text;
                }
            });
            inp.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
                if (e.key === 'Escape') { e.preventDefault(); const bug = bugs[inp.dataset.section].find(b => b.id === inp.dataset.id); if (bug) inp.value = bug.text; inp.blur(); }
            });
        });
    }

    function initBugEvents() {
        bugAddHome.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addBug('home', bugAddHome.value); bugAddHome.value = ''; } });
        bugAddTest.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addBug('test', bugAddTest.value); bugAddTest.value = ''; } });
        navBugTracker.addEventListener('click', () => { switchView(currentView === 'bugs' ? 'home' : 'bugs'); });
        bugMenuToggle.addEventListener('click', () => { sidebar.classList.toggle('open'); toggleOverlay(sidebar.classList.contains('open')); });
    }

    // ==========================================
    // Memo
    // ==========================================
    const MEMO_STORAGE_KEY = 'kyongmin_memo_data';
    let memos = [];
    let editingMemoId = null;
    let deletingMemoId = null;
    let memoSearchQuery = '';

    const memoList = $('#memoList');
    const memoEmpty = $('#memoEmpty');
    const memoAddBtn = $('#memoAddBtn');
    const memoSearchInput = $('#memoSearchInput');
    const memoSearchToggle = $('#memoSearchToggle');
    const memoSearchBox = $('#memoSearchBox');
    const memoEditModal = $('#memoEditModal');
    const memoTitleInput = $('#memoTitleInput');
    const memoContentInput = $('#memoContentInput');
    const memoModalTitle = $('#memoModalTitle');
    const memoModalSave = $('#memoModalSave');
    const memoModalCancel = $('#memoModalCancel');
    const memoModalClose = $('#memoModalClose');
    const memoDeleteBtn = $('#memoDeleteBtn');
    const memoPinToggle = $('#memoPinToggle');
    const memoColorPicker = $('#memoColorPicker');
    const memoConfirmModal = $('#memoConfirmModal');
    const memoConfirmDelete = $('#memoConfirmDelete');
    const memoConfirmCancel = $('#memoConfirmCancel');
    const memoMenuToggle = $('#memoMenuToggle');
    const badgeMemos = $('#badgeMemos');

    function loadMemos() {
        try {
            const data = localStorage.getItem(MEMO_STORAGE_KEY);
            memos = data ? JSON.parse(data) : [];
        } catch(e) { memos = []; }
    }

    function saveMemos() {
        try {
            localStorage.setItem(MEMO_STORAGE_KEY, JSON.stringify(memos));
        } catch(e) { showToast('메모 저장 중 오류가 발생했습니다.', 'error'); }
    }

    function createMemo(title, content, color, pinned) {
        const memo = {
            id: generateId(),
            title: title.trim(),
            content: content.trim(),
            color: color || 'default',
            pinned: !!pinned,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        memos.unshift(memo);
        saveMemos();
        return memo;
    }

    function updateMemo(id, data) {
        const memo = memos.find(m => m.id === id);
        if (!memo) return;
        if (data.title !== undefined) memo.title = data.title.trim();
        if (data.content !== undefined) memo.content = data.content.trim();
        if (data.color !== undefined) memo.color = data.color;
        if (data.pinned !== undefined) memo.pinned = data.pinned;
        memo.updatedAt = new Date().toISOString();
        saveMemos();
    }

    function deleteMemo(id) {
        memos = memos.filter(m => m.id !== id);
        saveMemos();
    }

    function getFilteredMemos() {
        if (!memoSearchQuery) return [...memos];
        const q = memoSearchQuery.toLowerCase();
        return memos.filter(m =>
            (m.title && m.title.toLowerCase().includes(q)) ||
            (m.content && m.content.toLowerCase().includes(q))
        );
    }

    function formatMemoDate(iso) {
        const d = new Date(iso);
        const now = new Date();
        const diffMs = now - d;
        const diffMin = Math.floor(diffMs / 60000);
        if (diffMin < 1) return '방금 전';
        if (diffMin < 60) return `${diffMin}분 전`;
        const diffHr = Math.floor(diffMin / 60);
        if (diffHr < 24) return `${diffHr}시간 전`;
        const diffDay = Math.floor(diffHr / 24);
        if (diffDay < 7) return `${diffDay}일 전`;
        return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' });
    }

    function escapeHtmlMemo(text) {
        return escapeHtml(text);
    }

    function renderMemos() {
        const filtered = getFilteredMemos();
        // 고정된 메모 먼저, 나머지는 최신순
        const pinned = filtered.filter(m => m.pinned);
        const unpinned = filtered.filter(m => !m.pinned);
        const sorted = [...pinned, ...unpinned];

        if (badgeMemos) badgeMemos.textContent = memos.length;

        if (sorted.length === 0) {
            memoList.innerHTML = '';
            memoEmpty.classList.add('show');
            return;
        }

        memoEmpty.classList.remove('show');
        memoList.innerHTML = sorted.map(m => {
            const colorClass = m.color && m.color !== 'default' ? ` color-${m.color}` : '';
            const pinnedClass = m.pinned ? ' pinned' : '';
            const title = m.title ? escapeHtmlMemo(m.title) : '<em style="color:var(--gray-300);">(제목 없음)</em>';
            const content = m.content ? escapeHtmlMemo(m.content) : '';
            const date = formatMemoDate(m.updatedAt);
            return `<div class="memo-card${colorClass}${pinnedClass}" data-memo-id="${m.id}">
                <div class="memo-card-title">${title}</div>
                ${content ? `<div class="memo-card-content">${content}</div>` : ''}
                <div class="memo-card-date">${date}</div>
            </div>`;
        }).join('');

        // Bind click to open edit
        memoList.querySelectorAll('.memo-card').forEach(card => {
            card.addEventListener('click', () => {
                openMemoModal(card.dataset.memoId);
            });
        });

        // 홈 메모 카드도 갱신
        renderHomeMemos();
    }

    function openMemoModal(id) {
        if (id) {
            const memo = memos.find(m => m.id === id);
            if (!memo) return;
            editingMemoId = id;
            memoModalTitle.textContent = '메모 수정';
            memoTitleInput.value = memo.title || '';
            memoContentInput.value = memo.content || '';
            memoDeleteBtn.style.display = 'inline-flex';
            // Set color
            setMemoColor(memo.color || 'default');
            // Set pin
            memoPinToggle.classList.toggle('active', !!memo.pinned);
        } else {
            editingMemoId = null;
            memoModalTitle.textContent = '새 메모';
            memoTitleInput.value = '';
            memoContentInput.value = '';
            memoDeleteBtn.style.display = 'none';
            setMemoColor('default');
            memoPinToggle.classList.remove('active');
        }
        memoEditModal.classList.add('show');
        setTimeout(() => memoTitleInput.focus(), 100);
    }

    function closeMemoModal() {
        memoEditModal.classList.remove('show');
        editingMemoId = null;
    }

    function saveMemoFromModal() {
        const title = memoTitleInput.value.trim();
        const content = memoContentInput.value.trim();
        if (!title && !content) {
            showToast('제목이나 내용을 입력하세요.', 'error');
            return;
        }
        const color = getSelectedMemoColor();
        const pinned = memoPinToggle.classList.contains('active');

        if (editingMemoId) {
            updateMemo(editingMemoId, { title, content, color, pinned });
            showToast('메모가 수정되었습니다.');
        } else {
            createMemo(title, content, color, pinned);
            showToast('새 메모가 추가되었습니다.');
        }
        closeMemoModal();
        renderMemos();
    }

    function setMemoColor(color) {
        memoColorPicker.querySelectorAll('.memo-color-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.color === color);
        });
    }

    function getSelectedMemoColor() {
        const active = memoColorPicker.querySelector('.memo-color-btn.active');
        return active ? active.dataset.color : 'default';
    }

    // ==========================================
    // Home Memo Cards
    // ==========================================
    function renderHomeMemos() {
        const grid = $('#homeMemoGrid');
        const empty = $('#homeMemoEmpty');
        const section = $('#homeMemoSection');
        if (!grid || !section) return;

        // 최근 메모 최대 6개 (고정 우선)
        const pinned = memos.filter(m => m.pinned);
        const unpinned = memos.filter(m => !m.pinned);
        const sorted = [...pinned, ...unpinned].slice(0, 6);

        if (sorted.length === 0) {
            grid.style.display = 'none';
            empty.style.display = 'block';
            return;
        }

        empty.style.display = 'none';
        grid.style.display = 'grid';
        grid.innerHTML = sorted.map(m => {
            const colorClass = m.color && m.color !== 'default' ? ` color-${m.color}` : '';
            const title = m.title ? escapeHtml(m.title) : '<em style="color:var(--gray-300);">(제목 없음)</em>';
            const content = m.content ? escapeHtml(m.content) : '';
            return `<div class="home-memo-card${colorClass}" data-memo-id="${m.id}">
                <div class="home-memo-card-title">${title}</div>
                ${content ? `<div class="home-memo-card-content">${content}</div>` : ''}
            </div>`;
        }).join('');

        // 카드 클릭 → 메모 뷰로 이동 후 편집 모달
        grid.querySelectorAll('.home-memo-card').forEach(card => {
            card.addEventListener('click', () => {
                switchView('memo');
                setTimeout(() => openMemoModal(card.dataset.memoId), 100);
            });
        });
    }

    function initMemoEvents() {
        if (!memoAddBtn) return;

        memoAddBtn.addEventListener('click', () => openMemoModal(null));
        memoModalSave.addEventListener('click', saveMemoFromModal);
        memoModalCancel.addEventListener('click', closeMemoModal);
        memoModalClose.addEventListener('click', closeMemoModal);

        // 홈 메모 "전체보기" 버튼
        const homeMemoMore = $('#homeMemoMore');
        if (homeMemoMore) {
            homeMemoMore.addEventListener('click', () => switchView('memo'));
        }

        // Close on overlay click
        memoEditModal.addEventListener('click', (e) => {
            if (e.target === memoEditModal) closeMemoModal();
        });

        // Enter in title → move to content
        memoTitleInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); memoContentInput.focus(); }
        });
        memoTitleInput.addEventListener('input', () => autoReplace(memoTitleInput));

        // Ctrl+Enter in content → save
        memoContentInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveMemoFromModal(); }
        });
        memoContentInput.addEventListener('input', () => autoReplace(memoContentInput));

        // Color picker
        memoColorPicker.querySelectorAll('.memo-color-btn').forEach(btn => {
            btn.addEventListener('click', () => setMemoColor(btn.dataset.color));
        });

        // Pin toggle
        memoPinToggle.addEventListener('click', () => {
            memoPinToggle.classList.toggle('active');
        });

        // Delete button → show confirm
        memoDeleteBtn.addEventListener('click', () => {
            if (!editingMemoId) return;
            deletingMemoId = editingMemoId;
            memoConfirmModal.classList.add('show');
        });

        // Confirm delete
        memoConfirmDelete.addEventListener('click', () => {
            if (deletingMemoId) {
                deleteMemo(deletingMemoId);
                showToast('메모가 삭제되었습니다.');
                deletingMemoId = null;
            }
            memoConfirmModal.classList.remove('show');
            closeMemoModal();
            renderMemos();
        });

        memoConfirmCancel.addEventListener('click', () => {
            deletingMemoId = null;
            memoConfirmModal.classList.remove('show');
        });

        memoConfirmModal.addEventListener('click', (e) => {
            if (e.target === memoConfirmModal) {
                deletingMemoId = null;
                memoConfirmModal.classList.remove('show');
            }
        });

        // Search
        if (memoSearchInput) {
            memoSearchInput.addEventListener('input', () => {
                memoSearchQuery = memoSearchInput.value.trim();
                renderMemos();
            });
        }

        // Mobile search toggle
        if (memoSearchToggle) {
            memoSearchToggle.addEventListener('click', () => {
                memoSearchBox.classList.toggle('mobile-open');
                if (memoSearchBox.classList.contains('mobile-open')) {
                    memoSearchInput.focus();
                }
            });
        }

        // Sidebar nav
        navMemo.addEventListener('click', () => { switchView(currentView === 'memo' ? 'home' : 'memo'); });

        // Memo menu toggle (hamburger)
        if (memoMenuToggle) {
            memoMenuToggle.addEventListener('click', () => {
                sidebar.classList.toggle('open');
                toggleOverlay(sidebar.classList.contains('open'));
            });
        }
    }

    // ==========================================
    // Home View — Calendar
    // ==========================================
    let calYear, calMonth, calSelectedDate = null;
    const calDays = $('#calDays'), calMonthLabel = $('#calMonth');
    const calPrev = $('#calPrev'), calNext = $('#calNext'), calTodayBtn = $('#calToday');
    const dayPanel = $('#dayPanel'), dayPanelTitle = $('#dayPanelTitle');
    const dayPanelCount = $('#dayPanelCount'), dayPanelList = $('#dayPanelList');
    const homeMenuToggle = $('#homeMenuToggle'), homeHeaderDate = $('#homeHeaderDate');
    const confettiContainer = $('#confettiContainer');

    function initCalendar() {
        const now = new Date();
        calYear = now.getFullYear();
        calMonth = now.getMonth();
        homeHeaderDate.textContent = now.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });

        calPrev.addEventListener('click', () => { calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } renderCalendar(); });
        calNext.addEventListener('click', () => { calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } renderCalendar(); });
        calTodayBtn.addEventListener('click', () => { const n = new Date(); calYear = n.getFullYear(); calMonth = n.getMonth(); calSelectedDate = formatDateKey(n); renderCalendar(); renderDayPanel(); });
        homeMenuToggle.addEventListener('click', () => { sidebar.classList.toggle('open'); toggleOverlay(sidebar.classList.contains('open')); });

        navHome.addEventListener('click', () => { switchView('home'); });
    }

    function formatDateKey(d) {
        const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }

    function getTodoDateKey(t) {
        // 사용자가 설정한 dueDate 우선
        if (t.dueDate) {
            // dueDate가 과거이고 미완료면 → 오늘로 표시 (캘린더용)
            if (!t.completed) {
                const todayKey = formatDateKey(new Date());
                if (t.dueDate < todayKey) return todayKey;
            }
            return t.dueDate;
        }
        // dueDate 없으면 createdAt 기반
        if (t.createdAt) {
            const key = formatDateKey(new Date(t.createdAt));
            // 과거이고 미완료면 → 오늘로 표시
            if (!t.completed) {
                const todayKey = formatDateKey(new Date());
                if (key < todayKey) return todayKey;
            }
            return key;
        }
        return null;
    }

    function getTodosForDate(dateKey) {
        // 해당 날짜의 top-level 할 일
        const topMatches = todos.filter(t => {
            if (t.type === 'text') return false;
            if (!isTopLevel(t)) return false;
            return getTodoDateKey(t) === dateKey;
        });
        const topIds = new Set(topMatches.map(t => t.id));
        // top-level + 그 자식들 포함
        return todos.filter(t => {
            if (t.type === 'text') return false;
            return topIds.has(t.id) || topIds.has(t.parentId);
        });
    }

    function renderCalendar() {
        calMonthLabel.textContent = `${calYear}년 ${calMonth + 1}월`;

        const firstDay = new Date(calYear, calMonth, 1).getDay();
        const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
        const prevMonthDays = new Date(calYear, calMonth, 0).getDate();
        const todayKey = formatDateKey(new Date());

        let html = '';

        // Previous month padding
        for (let i = firstDay - 1; i >= 0; i--) {
            const d = prevMonthDays - i;
            html += `<div class="cal-day other-month"><span class="cal-day-num">${d}</span></div>`;
        }

        // Current month
        for (let d = 1; d <= daysInMonth; d++) {
            const dateKey = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const isToday = dateKey === todayKey;
            const isSelected = dateKey === calSelectedDate;
            const dayTodos = getTodosForDate(dateKey);
            const total = dayTodos.length;
            const done = dayTodos.filter(t => t.completed).length;
            const allDone = total > 0 && done === total;

            let dotHtml = '';
            if (total > 0) {
                const fracClass = allDone ? ' all-done' : '';
                dotHtml = `<span class="cal-day-frac${fracClass}">${done}/${total}</span>`;
                if (allDone) dotHtml += '<span class="cal-day-celebrate">🎉</span>';
            }

            const classes = ['cal-day'];
            if (isToday) classes.push('today');
            if (isSelected) classes.push('selected');

            html += `<div class="${classes.join(' ')}" data-date="${dateKey}">
                <span class="cal-day-num">${d}</span>
                ${dotHtml}
            </div>`;
        }

        // Next month padding
        const totalCells = firstDay + daysInMonth;
        const remaining = (7 - (totalCells % 7)) % 7;
        for (let d = 1; d <= remaining; d++) {
            html += `<div class="cal-day other-month"><span class="cal-day-num">${d}</span></div>`;
        }

        calDays.innerHTML = html;

        // Click events
        calDays.querySelectorAll('.cal-day:not(.other-month)').forEach(el => {
            el.addEventListener('click', () => {
                calSelectedDate = el.dataset.date;
                renderCalendar();
                renderDayPanel();
            });
        });

        // If a date is selected, also refresh the panel
        if (calSelectedDate) renderDayPanel();
    }

    function renderDayPanel() {
        if (!calSelectedDate) {
            dayPanelTitle.textContent = '날짜를 선택하세요';
            dayPanelCount.textContent = '';
            dayPanelList.innerHTML = '<div class="day-panel-empty"><i class="fas fa-calendar-day"></i><p>캘린더에서 날짜를 클릭하세요</p></div>';
            return;
        }

        const d = new Date(calSelectedDate + 'T00:00:00');
        const label = d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });
        const dayTodos = getTodosForDate(calSelectedDate);
        const topOnly = dayTodos.filter(t => isTopLevel(t));
        const total = topOnly.length;
        const done = topOnly.filter(t => t.completed).length;
        const active = total - done;

        dayPanelTitle.textContent = label;
        dayPanelCount.textContent = total > 0 ? `${done} / ${total} 완료` : '';

        // 미완료 항목만 표시
        const activeTodos = dayTodos.filter(t => !t.completed);

        if (total === 0) {
            dayPanelList.innerHTML = '<div class="day-panel-empty"><i class="fas fa-face-smile"></i><p>이 날 등록된 할 일이 없습니다</p></div>';
            return;
        }

        let html = '';

        if (done === total && total > 0) {
            html += '<div class="day-celebrate-banner">🎉 모두 완료! 대단해요! 🎉</div>';
            dayPanelList.innerHTML = html;
            launchConfetti();
            return;
        }

        if (active === 0 && done > 0) {
            html += '<div class="day-celebrate-banner">🎉 모두 완료! 대단해요! 🎉</div>';
            dayPanelList.innerHTML = html;
            launchConfetti();
            return;
        }

        // 전체보기와 같은 순서 사용 (manualOrder 기반)
        const ordered = buildOrderedList(activeTodos);

        for (const t of ordered) {
            const catHtml = t.category ? `<span class="day-todo-cat ${t.category}">${getCategoryLabel(t.category)}</span>` : '';
            const isChild = !isTopLevel(t);
            const indentStyle = isChild ? ' style="padding-left:36px;"' : '';
            const subClass = isChild ? ' sub-item' : '';
            html += `<div class="day-todo-item${subClass}"${indentStyle}>
                <label class="day-todo-cb${isChild ? ' sub' : ''}">
                    <input type="checkbox" onchange="window.KTodo.toggleTodoHome('${t.id}')">
                    <span class="day-todo-cbmark"><i class="fas fa-check"></i></span>
                </label>
                ${catHtml}
                <span class="day-todo-text">${escapeHtml(t.text || '(미입력)')}</span>
            </div>`;
        }

        dayPanelList.innerHTML = html;
    }

    function toggleTodoHome(id) {
        toggleTodo(id);
        renderCalendar();
    }

    // ==========================================
    // Confetti Animation
    // ==========================================
    let confettiTimeout = null;
    function launchConfetti() {
        if (confettiTimeout) return; // prevent spam
        const colors = ['#f472b6', '#a78bfa', '#60a5fa', '#fbbf24', '#34d399', '#fb923c', '#f87171'];
        for (let i = 0; i < 60; i++) {
            const el = document.createElement('div');
            el.className = 'confetti';
            el.style.left = Math.random() * 100 + '%';
            el.style.background = colors[Math.floor(Math.random() * colors.length)];
            el.style.animationDelay = (Math.random() * 1) + 's';
            el.style.animationDuration = (2 + Math.random() * 1.5) + 's';
            el.style.width = (6 + Math.random() * 6) + 'px';
            el.style.height = (6 + Math.random() * 6) + 'px';
            el.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
            confettiContainer.appendChild(el);
        }
        confettiTimeout = setTimeout(() => {
            confettiContainer.innerHTML = '';
            confettiTimeout = null;
        }, 4000);
    }

    // ==========================================
    // Mobile Tabbar & Bottom Sheet
    // ==========================================
    const mobileTabbar = $('#mobileTabbar');
    const mobileMenuOverlay = $('#mobileMenuOverlay');
    const mobileMenuSheet = $('#mobileMenuSheet');

    function initMobileTabbar() {
        if (!mobileTabbar) return;

        // Tab clicks
        $$('.tab-item[data-tab]').forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.dataset.tab;
                if (tab === 'menu') {
                    openMobileMenu();
                    return;
                }
                setActiveTab(tab);
                switchView(tab === 'todo' ? 'todo' : tab === 'bugs' ? 'bugs' : tab === 'memo' ? 'memo' : 'home');
            });
        });

        // Mobile menu overlay close
        if (mobileMenuOverlay) {
            mobileMenuOverlay.addEventListener('click', (e) => {
                if (e.target === mobileMenuOverlay) closeMobileMenu();
            });
        }

        // Mobile menu filter items
        $$('.mobile-menu-item[data-mfilter]').forEach(btn => {
            btn.addEventListener('click', () => {
                setActiveTab('todo');
                switchView('todo');
                setFilter(btn.dataset.mfilter);
                updateMobileMenuActive();
                closeMobileMenu();
            });
        });

        // Mobile menu category items
        $$('.mobile-menu-item[data-mcategory]').forEach(btn => {
            btn.addEventListener('click', () => {
                setActiveTab('todo');
                switchView('todo');
                if (currentCategory === btn.dataset.mcategory) {
                    currentCategory = null; btn.classList.remove('active');
                    headerTitle.textContent = '전체 할 일'; setFilter('all');
                } else setCategory(btn.dataset.mcategory);
                updateMobileMenuActive();
                closeMobileMenu();
            });
        });

        // Mobile clear completed
        const mClear = $('#mClearCompleted');
        if (mClear) mClear.addEventListener('click', () => { clearCompleted(); closeMobileMenu(); });
    }

    function setActiveTab(tab) {
        $$('.tab-item[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    }

    function openMobileMenu() {
        if (!mobileMenuOverlay) return;
        updateMobileMenuStats();
        updateMobileMenuActive();
        mobileMenuOverlay.classList.add('show');
    }

    function closeMobileMenu() {
        if (!mobileMenuOverlay) return;
        mobileMenuOverlay.classList.remove('show');
    }

    function updateMobileMenuStats() {
        const mStatTotal = $('#mStatTotal'), mStatDone = $('#mStatDone'), mStatPending = $('#mStatPending');
        const mProgressPercent = $('#mProgressPercent'), mProgressFill = $('#mProgressFill');
        if (!mStatTotal) return;
        const todoItems = todos.filter(t => t.type !== 'text');
        const total = todoItems.length, completed = todoItems.filter(t => t.completed).length, pending = total - completed;
        const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
        mStatTotal.textContent = total;
        mStatDone.textContent = completed;
        mStatPending.textContent = pending;
        mProgressPercent.textContent = pct + '%';
        mProgressFill.style.width = pct + '%';
    }

    function updateMobileMenuActive() {
        $$('.mobile-menu-item[data-mfilter]').forEach(b => b.classList.toggle('active', b.dataset.mfilter === currentFilter && !currentCategory));
        $$('.mobile-menu-item[data-mcategory]').forEach(b => b.classList.toggle('active', b.dataset.mcategory === currentCategory));
    }

    // Sync mobile tab highlight when view switches
    function syncMobileTab() {
        if (currentView === 'home') setActiveTab('home');
        else if (currentView === 'bugs') setActiveTab('bugs');
        else if (currentView === 'memo') setActiveTab('memo');
        else setActiveTab('todo');
    }

    // ==========================================
    // Init
    // ==========================================
    // 미완료 할 일 자동 이월 (자정 기준)
    // migrateOverdueTodos 제거 — getTodoDateKey에서 동적 처리

    function init() {
        loadTodos(); loadSort(); loadBugs(); loadMemos();
        updateHeaderDate();
        renderTodos(); updateStats(); renderBugs(); renderMemos();
        initEventListeners(); initBugEvents(); initMemoEvents(); initCalendar(); initDoneSection(); initMobileTabbar();
        switchView('home');
    }

    window.KTodo = {
        toggleTodo, deleteTodo, toggleImportant, openEditModal,
        promote: promoteToTopLevel, toggleBug, deleteBug, toggleTodoHome,
        toggleCollapse
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

})();
