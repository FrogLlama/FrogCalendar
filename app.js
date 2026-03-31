// --- 구글 드라이브 연동 설정 ---
// 주의: 구글 클라우드 콘솔에서 "웹 애플리케이션"용 OAuth 클라이언트 ID를 새로 하나 발급받으셔야 합니다! (기존 PC용 ID는 웹에서 작동하지 않습니다)
const CLIENT_ID = '403706950790-bd5v27quhgrf39p6gluqjorf5tjeeh7e.apps.googleusercontent.com'; 
const SCOPES = 'https://www.googleapis.com/auth/drive.appdata';

let tokenClient;
let accessToken = null;
let calendarData = { Calendars: [], DailyNotes: [], RecurringNotes: [] };
let currentMonth = new Date();
let selectedTabId = null;
let webSyncTimer = null;

// --- 요소 가져오기 ---
const loginScreen = document.getElementById('login-screen');
const mainScreen = document.getElementById('main-screen');
const selTabs = document.getElementById('sel-tabs');
const grid = document.getElementById('calendar-grid');
const txtMonth = document.getElementById('txt-month-year');
const txtStatus = document.getElementById('txt-status');

const modal = document.getElementById('modal-note');
const txtEditor = document.getElementById('txt-editor');
const txtModalDate = document.getElementById('txt-modal-date');
let modalTargetDate = null;

// --- 디버그 시스템 로거 ---
function logDebug(msg) {
    const el = document.getElementById('debug-log');
    if(el) {
        let text = typeof msg === 'object' ? JSON.stringify(msg) : msg;
        el.innerHTML += `<br>[${new Date().toLocaleTimeString()}] ${text}`;
        el.scrollTop = el.scrollHeight;
    }
}
window.onerror = function(message, source, lineno, colno, error) {
    logDebug(`JS ERROR: ${message} at line ${lineno}`);
};

// --- 1. 브라우저 로딩 및 구글 인증 체계 초기화 ---
window.onload = () => {
    // ---- 1. PWA 홈 화면 추가 (A2HS) 설치 버튼 트리거 ----
    let deferredPrompt;
    const installBtn = document.getElementById('btn-install-app');
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        if (installBtn) installBtn.style.display = 'block';
    });

    if (installBtn) {
        installBtn.onclick = async () => {
            if (deferredPrompt) {
                deferredPrompt.prompt();
                const { outcome } = await deferredPrompt.userChoice;
                if (outcome === 'accepted') installBtn.style.display = 'none';
                deferredPrompt = null;
            }
        };
        
        // ---🍎 [아이폰 대응] iOS 사파리 감지 및 수동 안내 패치 ---
        const isIOS = /iPhone|iPad|iPod|Macintosh/i.test(navigator.userAgent) && 'ontouchend' in document;
        const isStandalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
        
        if (isIOS && !isStandalone) {
            installBtn.style.display = 'block';
            installBtn.style.background = '#333';
            installBtn.style.border = '1px solid #777';
            installBtn.innerText = "🍎 사파리 [공유] ➡ [홈 화면에 추가] 로 설치";
            installBtn.onclick = () => {
                alert("📱 아이폰(사파리)에서 정식 앱으로 설치하시려면:\n\n화면 맨 아래쪽에 있는 [공유 버튼(네모 상자와 위쪽 화살표)]을 누르신 뒤, 스크롤을 내려서 [홈 화면에 추가]를 눌러주세요!\n\n홈 화면에 예쁜 개구리 앱이 깔립니다! 🐸");
            };
        }
    }

    // ---- 2. 1시간 유지 자동 로그인 패스 (토큰 재활용) 및 오프라인 패스 ----
    const cachedToken = localStorage.getItem('frog_token');
    const tokenExp = localStorage.getItem('frog_token_exp');
    
    // 만약 오프라인 상태(비행기 모드 등)라면, 남은 수명과 관계 없이 일단 무사통과시킵니다.
    if (!navigator.onLine) {
        logDebug("▶ [오프라인] 인터넷 끊김! 즉시 읽기 전용 모드로 달력을 강제 오픈합니다.");
        loginScreen.classList.add('hidden');
        mainScreen.classList.remove('hidden');
        
        const offlineData = localStorage.getItem('frog_offline_data');
        if (offlineData) {
            calendarData = JSON.parse(offlineData);
            renderCalendar();
        }
        const st = document.getElementById('txt-status');
        st.innerText = "📵 오프라인 (읽기 전용)";
        st.style.color = "#ff9800"; // 주황색 경고
    }
    else if (cachedToken && tokenExp && Date.now() < parseInt(tokenExp)) {
        logDebug("▶ [자동 로그인] 1시간 유효 토큰 감지! 팝업 프리패스!");
        accessToken = cachedToken;
        loginScreen.classList.add('hidden');
        mainScreen.classList.remove('hidden');
        loadSnapshotFromDrive();
        startAutoSync();
    } else {
        logDebug("토큰 만료 혹은 첫 접속. 수동 로그인 대기 중.");
    }

    // ---- 3. 수동 로그인 버튼 동작 모듈 (GSI) ----
    logDebug("✅ 브라우저 준비 완료. 구글 모듈(GSI) 로딩 중...");
    
    // Google Identity Services 로드 대기
    google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: (response) => {
            if (response && response.access_token) {
                logDebug("자동 콜백 응답 도착");
                accessToken = response.access_token;
                loginScreen.classList.add('hidden');
                mainScreen.classList.remove('hidden');
                loadSnapshotFromDrive(); // 폰 뷰어의 심장: PC가 올려둔 JSON 다운로드
                startAutoSync();         // 웹 자동 동기화 가동
            } else {
                logDebug("콜백 응답에 토큰이 없습니다.");
            }
        }
    });

    document.getElementById('btn-login').onclick = () => {
        logDebug("▶ [구글 로그인] 버튼 클릭됨! 구글 팝업 호출 중...");
        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: SCOPES,
            callback: (res) => {
                logDebug("수동 로그인 팝업 콜백 완료.");
                accessToken = res.access_token;
                
                // 발급받은 열쇠를 금고에 1시간(~3500초) 보관하여 다음 방문 시 프리패스
                localStorage.setItem('frog_token', accessToken);
                localStorage.setItem('frog_token_exp', Date.now() + 3500 * 1000);
                
                loginScreen.classList.add('hidden');
                mainScreen.classList.remove('hidden');
                loadSnapshotFromDrive();
                startAutoSync();
            }
        });
        tokenClient.requestAccessToken();
    };
    
    // 달력 조작 버튼
    document.getElementById('btn-prev').onclick = () => { currentMonth.setMonth(currentMonth.getMonth() - 1); renderCalendar(); };
    document.getElementById('btn-next').onclick = () => { currentMonth.setMonth(currentMonth.getMonth() + 1); renderCalendar(); };
    selTabs.onchange = () => { selectedTabId = selTabs.value; renderCalendar(); };
    
    // 디버그 로그창 켜기/끄기 (강력 수정형)
    document.getElementById('btn-toggle-log').onclick = () => {
        const logEl = document.getElementById('debug-log');
        if (logEl) { 
            const isHidden = window.getComputedStyle(logEl).display === 'none';
            logEl.style.display = isHidden ? 'block' : 'none'; 
        }
    };

    // 모달 닫기
    document.getElementById('btn-close-modal').onclick = () => modal.classList.add('hidden');
    
    // 취소선(완료) 버튼 토글 로직
    document.getElementById('btn-strikethrough').onclick = () => {
        const val = txtEditor.value;
        const selStart = txtEditor.selectionStart;
        const selEnd = txtEditor.selectionEnd;
        if(selStart === selEnd) return; // 선택 안함
        
        const selected = val.substring(selStart, selEnd);
        let newText;
        if (selected.startsWith("~~") && selected.endsWith("~~")) {
            newText = selected.substring(2, selected.length - 2);
        } else {
            newText = `~~${selected}~~`;
        }
        txtEditor.value = val.substring(0, selStart) + newText + val.substring(selEnd);
    };

    // 🌟 저장 (구글 드라이브에 PWA 전용 로그 푸시)
    document.getElementById('btn-save').onclick = () => saveNoteToDrive();
};

// --- 2. 구글 드라이브 API 통신 ---
async function fetchGoogle(endpoint, method = 'GET', body = null) {
    logDebug(`▶ API Call [${method}] ${endpoint.substring(0, 40)}...`);
    const options = { method, headers: { Authorization: `Bearer ${accessToken}` } };
    if (body) {
        if (body instanceof FormData) { options.body = body; }
        else { options.headers['Content-Type'] = 'application/json'; options.body = body; }
    }
    const res = await fetch(`https://www.googleapis.com/drive/v3/${endpoint}`, options);
    logDebug(`◀ HTTP 응답 상태: ${res.status}`);
    const json = await res.json();
    if(json.error) logDebug(`❌ 구글 API 오류: ${JSON.stringify(json.error)}`);
    return json;
}

// --- 2-1. 웹 전용 자동 동기화 타이머 ---
function startAutoSync() {
    if (!webSyncTimer) {
        logDebug("⏰ [웹] 10초 주기 자동 동기화 감시 타이머 가동");
        webSyncTimer = setInterval(() => {
            // 내가 글씨를 적거나 모달 창이 뜬 상태에서는 새로고침으로 인한 날아감 방지!
            if (!document.getElementById('modal-note').classList.contains('hidden')) {
                return;
            }
            loadSnapshotFromDrive(true); // 조용히 백그라운드 스캔
        }, 10000);
    }
}

async function loadSnapshotFromDrive(isAutoSync = false) {
    if (!isAutoSync) txtStatus.innerText = "☁️ 캘린더 읽어오는 중...";
    logDebug("== 동기화 스냅샷 조회 시작 ==");
    try {
        // appDataFolder에서 파일 목록 검색 (반드시 인코딩 필요)
        const query = encodeURIComponent("name='FrogCalendar.json'");
        logDebug("드라이브 앱 전용 폴더 파일 검색 중...");
        const filesRes = await fetchGoogle(`files?spaces=appDataFolder&q=${query}`);
        
        if (!filesRes.files || filesRes.files.length === 0) {
            logDebug("❌ 드라이브에 FrogCalendar.json 파일이 존재하지 않습니다.");
            txtStatus.innerText = "상태: PC 데이터 없음 (먼저 PC에서 올려주세요)";
            return;
        }

        // 파일 다운로드 (스마트폰 브라우저 캐시 강제 무력화: 0.001초 난수 꼬리표 부착)
        const fileId = filesRes.files[0].id;
        logDebug(`✅ 발견! 파일 ID: ${fileId}. 다운로드 진행...`);
        
        // ?alt=media 뒤에 무의미한 타임스탬프 변수를 붙이면 브라우저가 매번 완전히 새로운 파일로 인식합니다.
        const bustCacheUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&_t=${new Date().getTime()}`;
        
        const res = await fetch(bustCacheUrl, { 
            headers: { 
                Authorization: `Bearer ${accessToken}`,
                'Cache-Control': 'no-cache, no-store, must-revalidate'
            }
        });
        logDebug(`⬇ 다운로드 완료 HTTP 상태: ${res.status}`);
        
        const rawText = await res.text();
        logDebug(`📦 데이터 용량: ${rawText.length} byte 받았음`);
        
        // ---💡 [오프라인 지원] 폰 내부 금고에 최신 일정 복사 저장 ---
        localStorage.setItem('frog_offline_data', rawText);
        
        calendarData = JSON.parse(rawText);
        logDebug(`✅ 파싱 완료! 매핑된 달력 탭: ${calendarData.Calendars ? calendarData.Calendars.length : 0}개`);

        // 탭 드롭다운 렌더링
        selTabs.innerHTML = '';
        calendarData.Calendars.sort((a,b) => a.SortOrder - b.SortOrder).forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.Id; opt.innerText = t.Name;
            selTabs.appendChild(opt);
        });
        if (calendarData.Calendars.length > 0) {
            selectedTabId = calendarData.Calendars[0].Id;
        }

        txtStatus.innerText = "✅ 동기화 됨";
        txtStatus.style.color = "#ccc"; // 원상복구
        renderCalendar();
    } catch (err) {
        logDebug(`JS ERROR: 스냅샷 조회 실패 ${err.message}`);
        
        // --- 💣 [오프라인 지원] 통신이 끊겼다면 금고에서 비상식량 꺼내오기 ---
        const offlineData = localStorage.getItem('frog_offline_data');
        if (offlineData) {
            calendarData = JSON.parse(offlineData);
            
            // 탭 드롭다운 복원 렌더링
            selTabs.innerHTML = '';
            let tabs = calendarData.Calendars || [];
            tabs.sort((a,b) => a.SortOrder - b.SortOrder).forEach(t => {
                const opt = document.createElement('option');
                opt.value = t.Id; opt.innerText = t.Name;
                selTabs.appendChild(opt);
            });
            if (tabs.length > 0) selectedTabId = tabs[0].Id;
            
            renderCalendar();
            txtStatus.innerText = "📵 통신 끊김 (읽기 전용)";
            txtStatus.style.color = "#ff9800";
        } else {
            txtStatus.innerText = "상태: 데이터 없음 (오프라인 상태)";
        }
    }
}

// --- 3. UI 렌더링 (PC의 MainWindow.xaml과 논리적 동일 구조) ---
function renderCalendar() {
    grid.innerHTML = ''; 
    ['일','월','화','수','목','금','토'].forEach(day => {
        grid.innerHTML += `<div class="cal-header">${day}</div>`;
    });

    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    txtMonth.innerText = `${year}.${String(month+1).padStart(2,'0')}`;

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // 42 cells
    for (let i = 0; i < 42; i++) {
        const cell = document.createElement('div');
        cell.className = 'cal-cell';
        if (i % 7 === 0) cell.classList.add('sunday');
        if (i % 7 === 6) cell.classList.add('sat');

        const dayNum = i - firstDay + 1;
        if (dayNum > 0 && dayNum <= daysInMonth) {
            const dateText = `${year}-${String(month+1).padStart(2,'0')}-${String(dayNum).padStart(2,'0')}`;
            cell.innerHTML = `<div class="day-num">${dayNum}</div>`;

            // 내용 찾기 (현재 선택된 탭 정보만)
            const note = calendarData.DailyNotes.find(n => n.CalendarId === selectedTabId && n.DateText === dateText);
            let rawContent = note ? note.Content : "";
            
            // 색상 파싱
            if (rawContent.startsWith("[C:#") && rawContent.length >= 11 && rawContent[10] === ']') {
                const colorCode = rawContent.substring(3, 10);
                cell.style.background = colorCode;
                rawContent = rawContent.substring(11);
            }

            // ~~취소선 파싱 렌더링
            let displayHtml = rawContent.replace(/~~(.*?)~~/g, '<span style="text-decoration:line-through;color:#aaa">$1</span>').replace(/\n/g, '<br>');
            
            if (displayHtml) {
                cell.innerHTML += `<div class="cell-note">${displayHtml}</div>`;
            }

            // 클릭 시 폰 에디터 오픈 (오프라인 통신 차단 방어막 탑재)
            cell.onclick = () => {
                if (!navigator.onLine || txtStatus.innerText.includes("읽기 전용")) {
                    alert("🚫 통신이 끊겨 오프라인(읽기 전용) 모드로 작동 중입니다.\n\n수정이 불가능하며 현재 폰 금고에 저장된 마지막 일정만 조회할 수 있습니다.");
                    return;
                }
                openNoteEditor(dateText, note ? note.Content : "");
            };
        }
        grid.appendChild(cell);
    }
}

// --- 4. 폰 전용 에디터 및 쓰기 ---
function openNoteEditor(dateText, existingContent) {
    modalTargetDate = dateText;
    txtModalDate.innerText = `${dateText} 메모`;
    
    // 색상 분리
    let colorPart = "";
    let textPart = existingContent;
    if (existingContent.startsWith("[C:#") && existingContent.length >= 11 && existingContent[10] === ']') {
        colorPart = existingContent.substring(3, 10).toUpperCase();
        textPart = existingContent.substring(11);
    }
    
    const radios = document.getElementsByName('color');
    for (let r of radios) { r.checked = (r.value === colorPart); }
    if (!colorPart) radios[0].checked = true;

    txtEditor.value = textPart;
    modal.classList.remove('hidden');
}

async function saveNoteToDrive() {
    txtStatus.innerText = "☁️ 클라우드(JSON) 덮어쓰기 중...";
    modal.classList.add('hidden');

    let selectedColor = "";
    for (let r of document.getElementsByName('color')) { if (r.checked) selectedColor = r.value; }
    let prefix = selectedColor ? `[C:${selectedColor}]` : "";
    let finalContent = prefix + txtEditor.value;
    let nowUtc = new Date().toISOString();

    logDebug("== JSON 마스터 파일 병합/저장 시작 ==");
    try {
        // 1. 마스터 파일(FrogCalendar.json) 최신본 가져오기
        const query = encodeURIComponent("name='FrogCalendar.json'");
        const filesRes = await fetchGoogle(`files?spaces=appDataFolder&q=${query}`);
        let fileId = filesRes.files && filesRes.files.length > 0 ? filesRes.files[0].id : null;

        let cloudData = { Calendars: [], DailyNotes: [], RecurringNotes: [] };
        
        if (fileId) {
            logDebug("클라우드 최신 JSON 다운로드 중...");
            const bustUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&_t=${new Date().getTime()}`;
            const dlRes = await fetch(bustUrl, { 
                headers: { 
                    Authorization: `Bearer ${accessToken}`,
                    'Cache-Control': 'no-cache, no-store, must-revalidate'
                }
            });
            if(dlRes.ok) {
                cloudData = await dlRes.json();
            }
        }

        // 2. 동시성 충돌 해결 (Smart Merge - Append)
        let existingNote = cloudData.DailyNotes.find(n => n.CalendarId === selectedTabId && n.DateText === modalTargetDate);
        if (existingNote) {
            // 똑같은 노트가 존재할 때, 내용이 서로 다르다면 이어붙이기
            let cleanFinal = txtEditor.value.trim();
            // 임시로 구글에 있던 내용에서 색상 태그를 제거하고 원본 텍스트만 추출해 비교
            let rawCloudText = existingNote.Content || "";
            if (rawCloudText.startsWith("[C:#") && rawCloudText.length >= 11 && rawCloudText[10] === ']') {
                rawCloudText = rawCloudText.substring(11);
            }
            rawCloudText = rawCloudText.trim();

            if (rawCloudText !== cleanFinal && rawCloudText.length > 0 && cleanFinal.length > 0) {
                logDebug("⚠️ 동시성 충돌 감지! 데이터를 날리지 않고 이어붙입니다 (Append).");
                finalContent = `${prefix}${rawCloudText} \n\n--- 폰에서 병합됨 ---\n\n ${cleanFinal}`;
            }
            existingNote.Content = finalContent;
            existingNote.UpdatedAt = nowUtc;
        } else {
            cloudData.DailyNotes.push({ 
                CalendarId: selectedTabId, 
                DateText: modalTargetDate, 
                Content: finalContent, 
                UpdatedAt: nowUtc 
            });
        }
        
        // 메모리에 즉시 반영 (화면 새로고침)
        calendarData = cloudData;
        renderCalendar();

        // 3. 통째로 구글 드라이브에 다시 엎어쓰기 (P2P JSON Master)
        logDebug("병합된 새 JSON 파일 구글 드라이브 업로드 중...");
        const jsonBlob = new Blob([JSON.stringify(cloudData, null, 2)], { type: 'application/json' });
        
        // ★ 핵심 버그 픽스: 이미 있는 파일을 덮어쓸(PATCH) 때는 구글 API 정책상 parents 옵션을 반드시 빼야 함!
        const metadata = fileId ? { name: 'FrogCalendar.json' } : { name: 'FrogCalendar.json', parents: ['appDataFolder'] };
        const form = new FormData();
        form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
        form.append('file', jsonBlob);

        let uploadRes;
        if (fileId) {
            uploadRes = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`, {
                method: 'PATCH', headers: { Authorization: `Bearer ${accessToken}` }, body: form
            });
        } else {
            uploadRes = await fetch(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`, {
                method: 'POST', headers: { Authorization: `Bearer ${accessToken}` }, body: form
            });
        }
        
        if (!uploadRes.ok) {
            const errText = await uploadRes.text();
            throw new Error(`업로드 HTTP 거부됨: ${uploadRes.status} -> ${errText}`);
        }
        
        logDebug("✅ 마스터 JSON 클라우드 저장 완료!");
        txtStatus.innerText = "✅ 폰(웹) 데이터 클라우드 저장 완료";
    } catch(err) {
        txtStatus.innerText = "전송 실패 (PC에는 반영안됨)";
        logDebug(`JS ERROR: 저장 중 예외 발생 ${err.message}`);
        console.error(err);
    }
}
