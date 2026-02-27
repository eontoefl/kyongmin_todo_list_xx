// 학습 일정으로 돌아가기 (과제 진행 중)
// ★ 팝업 규칙: docs/NAVIGATION_POPUPS.md 참고
function backToSchedule() {
    // 현재 활성화된 화면 확인
    const activeScreen = document.querySelector('.screen.active');
    let visibleScreen = activeScreen;
    if (!visibleScreen) {
        document.querySelectorAll('.screen').forEach(function(s) {
            if (!visibleScreen && s.style.display && s.style.display !== 'none') {
                visibleScreen = s;
            }
        });
    }
    const currentScreenId = visibleScreen ? visibleScreen.id : null;
    
    // ── 상태 수집 ──
    var isTaskListScreen = currentScreenId === 'welcomeScreen';
    var step1Done = window.AuthMonitor && AuthMonitor._step1Done;
    var step2Done = window.AuthMonitor && AuthMonitor._step2Done;
    var explanationDone = window.AuthMonitor && AuthMonitor._explanationDone;
    
    var errorNotePanel = document.getElementById('errorNotePanel');
    var hasErrorNote = errorNotePanel && window.ErrorNote;
    var errorNoteSubmitted = hasErrorNote && ErrorNote.isSubmitted();
    
    var explainScreen = document.getElementById('finalExplainScreen');
    var isOnExplainScreen = explainScreen && explainScreen.style.display && explainScreen.style.display !== 'none';
    
    // 연습/마감 모드는 팝업 없이 바로 이동
    var isPracticeOrDeadline = window._isPracticeMode || window._deadlinePassedMode;
    
    // 결과 화면 (vocab 등 FlowController를 안 거치는 과제의 결과 화면)
    var isResultScreen = currentScreenId && (
        currentScreenId === 'vocabResultScreen' ||
        currentScreenId.includes('Result')
    );
    // AuthMonitor가 활성화되지 않은 결과 화면 = vocab/intro-book 등 → 팝업 불필요
    var isNonFlowResult = isResultScreen && !(window.AuthMonitor && AuthMonitor.isActive);
    
    console.log('🔙 [뒤로가기] screen:', currentScreenId, 'step1:', step1Done, 'step2:', step2Done, 'explanation:', explanationDone, 'errorNote:', errorNoteSubmitted, 'explain:', isOnExplainScreen, 'nonFlow:', isNonFlowResult);
    
    // ── 판정 순서 (0→5, 먼저 매칭되면 실행) ──
    
    // 순서 0: 과제 목록 화면 / 연습·마감 모드 / FlowController 미사용 결과 화면 → 바로 이동
    if (isTaskListScreen || isPracticeOrDeadline || isNonFlowResult) {
        // 팝업 없이 통과
    }
    // 순서 1: 오답노트 제출 완료 → 완료 알림 후 이동
    else if (errorNoteSubmitted || explanationDone) {
        alert('✅ 과제가 완료되었습니다!');
    }
    // 순서 2: 해설 화면 진입, 오답노트 미제출
    else if ((isOnExplainScreen || hasErrorNote) && step1Done && step2Done) {
        if (!confirm('⚠️ 오답노트를 아직 제출하지 않았습니다.\n제출해야 100% 인증됩니다.\n\n나가시겠습니까?')) {
            return;
        }
    }
    // 순서 3: 2차 완료, 해설 안 봄
    else if (step1Done && step2Done) {
        if (!confirm('⚠️ 해설 확인과 오답노트 제출까지 완료해야\n100% 인증됩니다.\n\n나가시겠습니까?')) {
            return;
        }
    }
    // 순서 4: 1차 후 ~ 2차 진행 중
    else if (step1Done && !step2Done) {
        if (!confirm('⚠️ 지금 나가면 현재까지의 답안이 그대로 제출됩니다.\n인증률이 낮아질 수 있습니다.\n\n나가시겠습니까?')) {
            return;
        }
    }
    // 순서 5: 1차 풀이 중
    else if (!isTaskListScreen) {
        if (!confirm('⚠️ 지금 나가면 현재까지의 답안이 그대로 제출됩니다.\n인증률이 0%가 될 수 있습니다.\n\n나가시겠습니까?')) {
            return;
        }
    }
    
    console.log('🔙 [뒤로가기] 학습 일정으로 돌아가기 시작');
    
    // beforeunload 경고 해제
    if (window._beforeUnloadHandler) {
        window.removeEventListener('beforeunload', window._beforeUnloadHandler);
        window._beforeUnloadHandler = null;
        console.log('🚪 beforeunload 경고 해제 (뒤로가기)');
    }
    
    // 모든 미디어 즉시 중지
    stopAllMedia();
    
    // 모든 섹션 cleanup 호출
    if (typeof cleanupListeningConver === 'function') {
        cleanupListeningConver();
    }
    if (typeof cleanupListeningAnnouncement === 'function') {
        cleanupListeningAnnouncement();
    }
    if (typeof cleanupListeningResponse === 'function') {
        cleanupListeningResponse();
    }
    if (typeof cleanupListeningLecture === 'function') {
        cleanupListeningLecture();
    }
    if (typeof cleanupSpeakingRepeat === 'function') {
        cleanupSpeakingRepeat();
    }
    if (typeof cleanupSpeakingInterview === 'function') {
        cleanupSpeakingInterview();
    }
    if (typeof cleanupVocabTest === 'function') {
        cleanupVocabTest();
    }
    
    // 타이머 정지
    stopAllTimers();
    if (window.moduleController) {
        window.moduleController.stopModuleTimer();
        window.moduleController.stopQuestionTimer();
    }
    
    // 모든 화면 숨기기 (inline style 제거)
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
        screen.style.display = ''; // inline style 제거!
    });
    
    // 학습 일정 화면 표시
    const scheduleScreen = document.getElementById('scheduleScreen');
    scheduleScreen.classList.add('active');
    
    // 학습 일정 초기화
    if (currentUser) {
        initScheduleScreen();
    }
    
    console.log('✅ [뒤로가기] 학습 일정으로 돌아가기 완료');
}

// 모든 미디어 즉시 중지
function stopAllMedia() {
    console.log('🛑 모든 미디어 중지 시작');
    
    // 모든 Audio 요소 중지
    document.querySelectorAll('audio').forEach(audio => {
        audio.pause();
        audio.currentTime = 0;
        audio.src = '';
    });
    
    // 모든 Video 요소 중지
    document.querySelectorAll('video').forEach(video => {
        video.pause();
        video.currentTime = 0;
        video.src = '';
    });
    
    console.log('✅ 모든 미디어 중지 완료');
}

// 학습 일정으로 돌아가기 (결과 화면에서)
function backToScheduleFromResult() {
    // 모든 미디어 즉시 중지
    stopAllMedia();
    
    // 타이머 정지
    stopAllTimers();
    
    // 답안 초기화
    userAnswers = {
        reading: {},
        listening: {},
        speaking: {},
        writing: {}
    };
    
    // 상태 초기화
    currentTest = {
        section: null,
        currentQuestion: 0,
        currentPassage: 0,
        currentTask: 0,
        startTime: null,
        answers: {},
        currentWeek: null,
        currentDay: null
    };
    
    // 모든 화면 숨기기 (inline style 제거)
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
        screen.style.display = ''; // inline style 제거!
    });
    
    // 학습 일정 화면 표시
    const scheduleScreen = document.getElementById('scheduleScreen');
    scheduleScreen.classList.add('active');
    
    // 학습 일정 초기화
    if (currentUser) {
        initScheduleScreen();
    }
}
