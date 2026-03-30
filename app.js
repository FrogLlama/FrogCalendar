// --- 구글 드라이브 연동 설정 ---
// 주의: 구글 클라우드 콘솔에서 "웹 애플리케이션"용 OAuth 클라이언트 ID를 새로 하나 발급받으셔야 합니다! (기존 PC용 ID는 웹에서 작동하지 않습니다)
const CLIENT_ID = '403706950790-bd5v27quhgrf39p6gluqjorf5tjeeh7e.apps.googleusercontent.com'; 
const SCOPES = 'https://www.googleapis.com/auth/drive.appdata';

let tokenClient;
let accessToken = null;
let calendarData = { Calendars: [], DailyNotes: [] };
let currentMonth = new Date();
let selectedTabId = null;

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

// --- 1. 브라우저 로딩 및 구글 인증 체계 초기화 ---
window.onload = () => {
    // Google Identity Services 로드 대기
    google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: (response) => {
            if (response && response.access_token) {
                accessToken = response.access_token;
                loginScreen.classList.add('hidden');
                mainScreen.classList.remove('hidden');
                loadSnapshotFromDrive(); // 폰 뷰어의 심장: PC가 올려둔 JSON 다운로드
            }
        }
    });

    document.getElementById('btn-login').onclick = () => {
        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: SCOPES,
            callback: (res) => {
                accessToken = res.access_token;
                loginScreen.classList.add('hidden');
                mainScreen.classList.remove('hidden');
                loadSnapshotFromDrive();
            }
        });
        tokenClient.requestAccessToken();
    };
    
    // 달력 조작 버튼
    document.getElementById('btn-prev').onclick = () => { currentMonth.setMonth(currentMonth.getMonth() - 1); renderCalendar(); };
    document.getElementById('btn-next').onclick = () => { currentMonth.setMonth(currentMonth.getMonth() + 1); renderCalendar(); };
    selTabs.onchange = () => { selectedTabId = selTabs.value; renderCalendar(); };

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
    const options = { method, headers: { Authorization: `Bearer ${accessToken}` } };
    if (body) {
        if (body instanceof FormData) { options.body = body; }
        else { options.headers['Content-Type'] = 'application/json'; options.body = body; }
    }
    const res = await fetch(`https://www.googleapis.com/drive/v3/${endpoint}`, options);
    return res.json();
}

async function loadSnapshotFromDrive() {
    txtStatus.innerText = "☁️ 캘린더 읽어오는 중...";
    try {
        // appDataFolder에서 파일 목록 검색
        const filesRes = await fetchGoogle("files?spaces=appDataFolder&q=name='FrogCalendar.json'");
        if (!filesRes.files || filesRes.files.length === 0) {
            txtStatus.innerText = "상태: PC 데이터 없음 (먼저 PC에서 올려주세요)";
            return;
        }

        // 파일 다운로드
        const fileId = filesRes.files[0].id;
        const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, { headers: { Authorization: `Bearer ${accessToken}` }});
        calendarData = await res.json();

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
        renderCalendar();
    } catch (err) {
        txtStatus.innerText = "오류 발생: " + err;
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

            // 클릭 시 폰 에디터 오픈
            cell.onclick = () => openNoteEditor(dateText, note ? note.Content : "");
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
    txtStatus.innerText = "☁️ 폰 메모 전송 중...";
    modal.classList.add('hidden');

    // 1. 색상 가져오기
    let selectedColor = "";
    for (let r of document.getElementsByName('color')) { if (r.checked) selectedColor = r.value; }
    let prefix = selectedColor ? `[C:${selectedColor}]` : "";
    let finalContent = prefix + txtEditor.value;

    // 2. 임시 (로컬 메모리) 즉시 반영
    let existing = calendarData.DailyNotes.find(n => n.CalendarId === selectedTabId && n.DateText === modalTargetDate);
    if (existing) { existing.Content = finalContent; } 
    else { calendarData.DailyNotes.push({ CalendarId: selectedTabId, DateText: modalTargetDate, Content: finalContent }); }
    renderCalendar();

    // 3. PC가 가져갈 수 있도록 병합용 ChangeLog 생성 
    const changeLog = JSON.stringify({
        Id: crypto.randomUUID(),
        DeviceId: "PWA_Phone", // 모바일 기기 식별자
        Entity: "daily_note",
        EntityId: `${selectedTabId}|${modalTargetDate}`,
        Operation: finalContent.trim() === "" ? "DELETE" : "UPDATE",
        Content: finalContent,
        TimestampUtc: new Date().toISOString()
    }) + "\n";

    try {
        // 기존 폰 전용 파일이 있는지 확인 후 덧붙이기 (Append/Upload 로직)
        const fileRes = await fetchGoogle("files?spaces=appDataFolder&q=name='device_PWA_Phone.jsonl'");
        let fileId = fileRes.files && fileRes.files.length > 0 ? fileRes.files[0].id : null;

        let previousData = "";
        if (fileId) {
            const dlRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, { headers: { Authorization: `Bearer ${accessToken}` }});
            previousData = await dlRes.text();
        }

        const newData = previousData + changeLog;
        const metadata = { name: 'device_PWA_Phone.jsonl', parents: ['appDataFolder'] };
        const form = new FormData();
        form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
        form.append('file', new Blob([newData], { type: 'text/plain' }));

        if (fileId) {
            // 업데이트
            await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`, {
                method: 'PATCH', headers: { Authorization: `Bearer ${accessToken}` }, body: form
            });
        } else {
            // 신규 생성
            await fetch(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`, {
                method: 'POST', headers: { Authorization: `Bearer ${accessToken}` }, body: form
            });
        }
        
        txtStatus.innerText = "✅ 폰(웹) 데이터 클라우드 저장 완료";
    } catch(err) {
        txtStatus.innerText = "전송 실패 (PC에는 반영안됨)";
        console.error(err);
    }
}
