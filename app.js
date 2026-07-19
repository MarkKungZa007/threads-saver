// Service Worker Registration for PWA (Only on mobile/non-localhost to prevent caching on PC)
if ("serviceWorker" in navigator) {
    if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
        navigator.serviceWorker.getRegistrations().then(registrations => {
            for (let registration of registrations) {
                registration.unregister().then(() => {
                    console.log("Service Worker unregistered on localhost.");
                });
            }
        });
    } else {
        window.addEventListener("load", () => {
            navigator.serviceWorker.register("sw.js")
                .then(reg => console.log("Service Worker registered!", reg))
                .catch(err => console.log("Service Worker registration failed:", err));
        });
    }
}

// Standalone Client Storage Provider (IndexedDB vs Local Server)
class AppStorage {
    static isLocal() {
        return window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
    }

    static async initIndexedDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open("ThreadsSaverDB", 1);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains("posts")) {
                    db.createObjectStore("posts", { keyPath: "folder_name" });
                }
                if (!db.objectStoreNames.contains("media")) {
                    db.createObjectStore("media");
                }
                if (!db.objectStoreNames.contains("settings")) {
                    db.createObjectStore("settings");
                }
            };
            request.onsuccess = (e) => resolve(e.target.result);
            request.onerror = (e) => reject(e.target.error);
        });
    }

    static async getDB() {
        if (!this.db) {
            this.db = await this.initIndexedDB();
        }
        return this.db;
    }

    static async getHistory() {
        if (this.isLocal()) {
            try {
                const res = await fetch("/api/history");
                return await res.json();
            } catch (err) {
                console.warn("Local server offline, fallback to IndexedDB", err);
            }
        }
        
        const db = await this.getDB();
        return new Promise((resolve) => {
            const tx = db.transaction("posts", "readonly");
            const store = tx.objectStore("posts");
            const req = store.getAll();
            req.onsuccess = () => {
                const list = req.result || [];
                resolve(list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)));
            };
            req.onerror = () => resolve([]);
        });
    }

    static async createPost(postData, mediaFiles) {
        if (this.isLocal()) {
            try {
                const res = await fetch("/api/create-custom-post", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ 
                        username: postData.username,
                        caption: postData.caption,
                        note: postData.note,
                        files: mediaFiles 
                    })
                });
                return await res.json();
            } catch (err) {
                console.warn("Local server offline, fallback to IndexedDB", err);
            }
        }

        const db = await this.getDB();
        const folderName = `custom_${Date.now()}`;
        const fullPost = {
            folder_name: folderName,
            username: postData.username || "my_post",
            caption: postData.caption || "",
            note: postData.note || "",
            schedule_time: postData.schedule_time || "",
            posted: postData.posted || false,
            timestamp: Date.now(),
            labels: { star: false, heart: false, save: false },
            media: []
        };

        const tx = db.transaction(["posts", "media"], "readwrite");
        
        for (let i = 0; i < mediaFiles.length; i++) {
            const fileObj = mediaFiles[i];
            let blob;
            if (fileObj.data && fileObj.name) {
                const binary = atob(fileObj.data.split(",")[1]);
                const array = [];
                for (let j = 0; j < binary.length; j++) {
                    array.push(binary.charCodeAt(j));
                }
                blob = new Blob([new Uint8Array(array)], { type: fileObj.type });
            } else {
                blob = fileObj;
            }

            const extension = blob.type.startsWith("video/") ? "mp4" : "jpg";
            const filename = blob.type.startsWith("video/") ? `video_${i+1}.${extension}` : `image_${i+1}.${extension}`;
            
            tx.objectStore("media").put(blob, `${folderName}_${filename}`);
            fullPost.media.push(filename);
        }

        tx.objectStore("posts").put(fullPost);

        return new Promise((resolve) => {
            tx.oncomplete = () => resolve({ success: true, folder_name: folderName, post: fullPost });
        });
    }

    static async getMediaUrl(folderName, filename) {
        if (this.isLocal()) {
            return `/downloads/${folderName}/${filename}`;
        }
        
        const db = await this.getDB();
        return new Promise((resolve) => {
            const tx = db.transaction("media", "readonly");
            const store = tx.objectStore("media");
            const req = store.get(`${folderName}_${filename}`);
            req.onsuccess = () => {
                if (req.result) {
                    resolve(URL.createObjectURL(req.result));
                } else {
                    resolve("");
                }
            };
            req.onerror = () => resolve("");
        });
    }

    static async saveNote(folderName, note) {
        if (this.isLocal()) {
            try {
                const res = await fetch("/api/save-note", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ folder_name: folderName, note: note })
                });
                return await res.json();
            } catch (err) {
                console.warn(err);
            }
        }
        
        const db = await this.getDB();
        const tx = db.transaction("posts", "readwrite");
        const store = tx.objectStore("posts");
        const post = await new Promise((r) => {
            const req = store.get(folderName);
            req.onsuccess = () => r(req.result);
        });
        if (post) {
            post.note = note;
            store.put(post);
        }
        return new Promise(r => tx.oncomplete = () => r({ success: true }));
    }

    static async saveSchedule(folderName, scheduleTime, posted) {
        if (this.isLocal()) {
            try {
                const res = await fetch("/api/save-schedule", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ folder_name: folderName, schedule_time: scheduleTime, posted: posted })
                });
                return await res.json();
            } catch (err) {
                console.warn(err);
            }
        }
        
        const db = await this.getDB();
        const tx = db.transaction("posts", "readwrite");
        const store = tx.objectStore("posts");
        const post = await new Promise((r) => {
            const req = store.get(folderName);
            req.onsuccess = () => r(req.result);
        });
        if (post) {
            post.schedule_time = scheduleTime;
            post.posted = posted;
            store.put(post);
        }
        return new Promise(r => tx.oncomplete = () => r({ success: true }));
    }

    static async saveLabels(folderName, labels) {
        if (this.isLocal()) {
            try {
                const res = await fetch("/api/save-labels", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ folder_name: folderName, labels: labels })
                });
                return await res.json();
            } catch (err) {
                console.warn(err);
            }
        }
        
        const db = await this.getDB();
        const tx = db.transaction("posts", "readwrite");
        const store = tx.objectStore("posts");
        const post = await new Promise((r) => {
            const req = store.get(folderName);
            req.onsuccess = () => r(req.result);
        });
        if (post) {
            post.labels = {
                star: labels.star,
                heart: labels.heart,
                save: labels.save
            };
            store.put(post);
        }
        return new Promise(r => tx.oncomplete = () => r({ success: true }));
    }

    static async deletePost(folderName) {
        if (this.isLocal()) {
            try {
                const res = await fetch("/api/delete-history", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ folder_name: folderName })
                });
                return await res.json();
            } catch (err) {
                console.warn(err);
            }
        }
        
        const db = await this.getDB();
        const tx = db.transaction(["posts", "media"], "readwrite");
        const postStore = tx.objectStore("posts");
        
        const post = await new Promise((r) => {
            const req = postStore.get(folderName);
            req.onsuccess = () => r(req.result);
        });

        if (post) {
            if (post.media) {
                post.media.forEach(m => {
                    tx.objectStore("media").delete(`${folderName}_${m}`);
                });
            }
            postStore.delete(folderName);
        }
        return new Promise(r => tx.oncomplete = () => r({ success: true }));
    }

    static async getBlob(folderName, filename) {
        const db = await this.getDB();
        return new Promise((resolve) => {
            const tx = db.transaction("media", "readonly");
            const store = tx.objectStore("media");
            const req = store.get(`${folderName}_${filename}`);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null);
        });
    }

    static async importPost(post, base64MediaFiles) {
        const db = await this.getDB();
        const tx = db.transaction(["posts", "media"], "readwrite");
        
        tx.objectStore("posts").put(post);
        
        for (const filename of Object.keys(base64MediaFiles)) {
            const b64Data = base64MediaFiles[filename];
            const binary = atob(b64Data.split(",")[1]);
            const array = [];
            for (let i = 0; i < binary.length; i++) {
                array.push(binary.charCodeAt(i));
            }
            const mimeType = filename.endsWith(".mp4") ? "video/mp4" : "image/jpeg";
            const blob = new Blob([new Uint8Array(array)], { type: mimeType });
            tx.objectStore("media").put(blob, `${post.folder_name}_${filename}`);
        }
        
        return new Promise(r => tx.oncomplete = () => r());
    }
}

// UI Initialization
document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("download-form");
    const input = document.getElementById("threads-url");
    const includeCommentsCheckbox = document.getElementById("include-comments");
    const submitBtn = document.getElementById("submit-btn");
    const historyList = document.getElementById("history-list");
    
    const statusCard = document.getElementById("status-card");
    const errorCard = document.getElementById("error-card");
    const errorMessage = document.getElementById("error-message");
    const previewCard = document.getElementById("preview-card");
    
    const stepConnect = document.getElementById("step-connect");
    const stepFetch = document.getElementById("step-fetch");
    const stepParse = document.getElementById("step-parse");
    const stepSave = document.getElementById("step-save");
    
    const saveLocation = document.getElementById("save-location");
    const openFolderBtn = document.getElementById("open-folder-btn");
    const copyAllBtn = document.getElementById("copy-all-btn");
    
    const authorAvatar = document.getElementById("post-author-avatar");
    const authorName = document.getElementById("post-author-name");
    const postCaption = document.getElementById("post-caption");
    const captionContainer = document.getElementById("caption-container");
    const mediaGallery = document.getElementById("media-gallery");
    const commentsCount = document.getElementById("comments-count");
    const commentsList = document.getElementById("comments-list");
    const postNote = document.getElementById("post-note");
    const saveNoteBtn = document.getElementById("save-note-btn");
    const noteStatus = document.getElementById("note-status");
    
    const postScheduleTime = document.getElementById("post-schedule-time");
    const clearScheduleBtn = document.getElementById("clear-schedule-btn");
    const scheduleWarning = document.getElementById("schedule-warning");
    const scheduleWarningText = document.getElementById("schedule-warning-text");
    const scheduleStatus = document.getElementById("schedule-status");
    const togglePostedBtn = document.getElementById("toggle-posted-btn");
    
    const openCalendarBtn = document.getElementById("open-calendar-btn");
    const calendarModal = document.getElementById("calendar-modal");
    const closeCalendarBtn = document.getElementById("close-calendar-btn");
    const prevMonthBtn = document.getElementById("prev-month-btn");
    const nextMonthBtn = document.getElementById("next-month-btn");
    const previewCooldownInfo = document.getElementById("preview-cooldown-info");
    const previewCooldownText = document.getElementById("preview-cooldown-text");
    
    const openCreatorBtn = document.getElementById("open-creator-btn");
    const randomPostBtn = document.getElementById("random-post-btn");
    const creatorModal = document.getElementById("creator-modal");
    const closeCreatorBtn = document.getElementById("close-creator-btn");
    const closeCreatorTitleBtn = document.getElementById("close-creator-title-btn");
    const saveCreatorBtn = document.getElementById("save-creator-btn");
    const creatorUsername = document.getElementById("creator-username");
    const creatorCaption = document.getElementById("creator-caption");
    const creatorNote = document.getElementById("creator-note");
    const creatorDropzone = document.getElementById("creator-dropzone");
    const creatorFileInput = document.getElementById("creator-file-input");
    const creatorPreviews = document.getElementById("creator-previews");
    let creatorFiles = [];

    const openSettingsBtn = document.getElementById("open-settings-btn");
    const settingsModal = document.getElementById("settings-modal");
    const closeSettingsBtn = document.getElementById("close-settings-btn");
    const closeSettingsTitleBtn = document.getElementById("close-settings-title-btn");
    const saveSettingsBtn = document.getElementById("save-settings-btn");
    const settingsDownloadsDir = document.getElementById("settings-downloads-dir");
    
    const openBackupBtn = document.getElementById("open-backup-btn");
    const backupModal = document.getElementById("backup-modal");
    const closeBackupBtn = document.getElementById("close-backup-btn");
    const closeBackupTitleBtn = document.getElementById("close-backup-title-btn");
    const importFileInput = document.getElementById("import-file-input");
    const importBtn = document.getElementById("import-btn");
    const exportBtn = document.getElementById("export-btn");
    const exportSelectAllBtn = document.getElementById("export-select-all-btn");
    const exportDeselectAllBtn = document.getElementById("export-deselect-all-btn");
    const exportListBox = document.getElementById("export-list-box");

    const openHelpBtn = document.getElementById("open-help-btn");
    const helpModal = document.getElementById("help-modal");
    const closeHelpBtn = document.getElementById("close-help-btn");
    const closeHelpTitleBtn = document.getElementById("close-help-title-btn");

    const historySort = document.getElementById("history-sort");
    let historyDataArray = [];
    
    let downloadedDirectory = "";
    let progressInterval = null;
    let currentDownload = null;
    let currentFolderName = "";
    let autosaveTimeout = null;
    let statusFadeTimeout = null;
    let activeFilter = "all";
    let currentPostedState = false;
 
    // Load download history on page load
    loadHistory();

    // Start live countdown updater (every 10 seconds)
    setInterval(updateAllCountdowns, 10000);

    // Setup Theme Selector listeners from Header
    document.querySelectorAll(".theme-box").forEach(box => {
        box.addEventListener("click", () => {
            const theme = box.dataset.theme;
            setAppTheme(theme);
        });
    });

    // Theme Switcher implementation
    function setAppTheme(themeName) {
        document.documentElement.className = ""; // clear all
        if (themeName !== "standard") {
            document.documentElement.classList.add(`theme-${themeName}`);
        }
        localStorage.setItem("threads-saver-theme", themeName);
        
        // Highlight active square
        document.querySelectorAll(".theme-box").forEach(box => {
            if (box.dataset.theme === themeName) {
                box.style.outline = "2px solid #000080";
            } else {
                box.style.outline = "none";
            }
        });
    }

    // Load saved theme
    const savedTheme = localStorage.getItem("threads-saver-theme") || "standard";
    setAppTheme(savedTheme);

    // Setup filter buttons
    document.querySelectorAll(".filter-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".filter-btn").forEach(b => {
                b.classList.remove("active");
            });
            btn.classList.add("active");
            
            activeFilter = btn.dataset.filter;
            renderHistoryList();
        });
    });

    historySort.addEventListener("change", () => {
        renderHistoryList();
    });

    // Click to copy caption
    captionContainer.addEventListener("click", async () => {
        const text = postCaption.textContent;
        if (!text || text === "No caption text." || text === "Caption text goes here...") return;
        
        try {
            await navigator.clipboard.writeText(text);
            captionContainer.classList.add("copied");
            const originalText = postCaption.innerHTML;
            postCaption.innerHTML = `<span style="color: var(--success-green); font-weight: bold;"><i class="fa-solid fa-circle-check"></i> คัดลอกแคปชั่นแล้ว! (Copied Caption!)</span>`;
            setTimeout(() => {
                postCaption.innerHTML = originalText;
                captionContainer.classList.remove("copied");
            }, 1500);
        } catch (err) {
            console.error("Failed to copy caption:", err);
        }
    });

    async function loadHistory() {
        try {
            historyDataArray = await AppStorage.getHistory();
            renderHistoryList();
        } catch (err) {
            console.error("Failed to load history:", err);
        }
    }

    function renderHistoryList() {
        historyList.innerHTML = "";
        
        if (historyDataArray && historyDataArray.length > 0) {
            let chronologicalHistory = [...historyDataArray];
            
            function getFolderOrderKey(item) {
                const parts = item.folder_name.split("_");
                const suffix = parts[parts.length - 1];
                if (item.folder_name.includes("custom_")) {
                    const customParts = item.folder_name.split("custom_");
                    const ts = parseInt(customParts[customParts.length - 1]) || 0;
                    return BigInt(ts) * 1000000000n;
                }
                try {
                    return BigInt(suffix) || 0n;
                } catch (e) {
                    return BigInt(Math.floor(item.timestamp || 0));
                }
            }

            chronologicalHistory.sort((a, b) => {
                const keyA = getFolderOrderKey(a);
                const keyB = getFolderOrderKey(b);
                if (keyA < keyB) return -1;
                if (keyA > keyB) return 1;
                return 0;
            });
            
            const itemSeqMap = new Map();
            chronologicalHistory.forEach((item, idx) => {
                itemSeqMap.set(item.folder_name, idx + 1);
            });

            let sortedHistory = [...historyDataArray];
            if (activeFilter !== "all") {
                sortedHistory = sortedHistory.filter(item => {
                    const labels = item.labels || { heart: false, star: false, save: false };
                    return labels[activeFilter] === true;
                });
            }

            const sortBy = historySort.value;
            if (sortBy === "oldest") {
                sortedHistory.sort((a, b) => itemSeqMap.get(a.folder_name) - itemSeqMap.get(b.folder_name));
            } else {
                sortedHistory.sort((a, b) => itemSeqMap.get(b.folder_name) - itemSeqMap.get(a.folder_name));
            }

            sortedHistory.forEach((item) => {
                const div = document.createElement("div");
                let stateClass = "ready-to-post";
                const now = new Date();
                if (item.posted === true) {
                    stateClass = "posted";
                } else if (item.schedule_time) {
                    const start = new Date(item.schedule_time);
                    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
                    if (now < start) {
                        stateClass = "scheduled-waiting";
                    } else if (now >= start && now < end) {
                        stateClass = "posted";
                    } else {
                        stateClass = "ready-to-post";
                    }
                }

                div.className = `history-item ${stateClass}`;
                div.dataset.folderName = item.folder_name;
                
                const idxNum = itemSeqMap.get(item.folder_name) || 0;
                
                const labels = item.labels || { heart: false, star: false, save: false };
                const labelsMarkup = `
                    <button class="label-btn ${labels.heart ? 'active' : ''}" data-label="heart" title="Heart"><i class="fa-solid fa-heart"></i></button>
                    <button class="label-btn ${labels.star ? 'active' : ''}" data-label="star" title="Star"><i class="fa-solid fa-star"></i></button>
                    <button class="label-btn ${labels.save ? 'active' : ''}" data-label="save" title="Save"><i class="fa-solid fa-bookmark"></i></button>
                `;

                div.innerHTML = `
                    <div class="history-item-header">
                        <span class="history-index-tag">${idxNum}. @${item.username || "my_post"}</span>
                        <div class="history-item-actions">
                            ${labelsMarkup}
                            <button class="delete-btn" title="Delete post"><i class="fa-solid fa-trash"></i></button>
                        </div>
                    </div>
                `;

                // Render thumbnails dynamically in the background without blocking DOM ordering
                async function loadThumbnailsAsync() {
                    let mediaFiles = [];
                    if (item.media && Array.isArray(item.media)) {
                        mediaFiles = item.media;
                    } else {
                        mediaFiles = [...(item.images || []), ...(item.videos || [])];
                    }

                    if (mediaFiles.length > 0) {
                        const thumbs = document.createElement("div");
                        thumbs.className = "history-item-thumbnails";
                        
                        const displayFiles = mediaFiles.slice(0, 6);
                        for (const f of displayFiles) {
                            const thumbUrl = await AppStorage.getMediaUrl(item.folder_name, f);
                            if (thumbUrl) {
                                if (f.toLowerCase().endsWith(".mp4")) {
                                    const thumb = document.createElement("div");
                                    thumb.className = "history-thumb-video";
                                    thumb.innerHTML = `<i class="fa-solid fa-play"></i>`;
                                    thumbs.appendChild(thumb);
                                } else {
                                    const imgEl = document.createElement("img");
                                    imgEl.className = "history-thumb";
                                    imgEl.src = thumbUrl;
                                    thumbs.appendChild(imgEl);
                                }
                            }
                        }
                        div.appendChild(thumbs);
                    }
                }
                loadThumbnailsAsync();

                // Handle clicking the item to load preview
                div.addEventListener("click", (e) => {
                    if (e.target.closest("button")) return;
                    showPostPreview(item);
                });

                // Handle delete action
                div.querySelector(".delete-btn").addEventListener("click", async (e) => {
                    e.stopPropagation();
                    if (confirm(`คุณต้องการลบโพสต์ลำดับที่ ${idxNum} ใช่หรือไม่?`)) {
                        const res = await AppStorage.deletePost(item.folder_name);
                        if (res && res.success) {
                            if (currentFolderName === item.folder_name) {
                                previewCard.classList.add("hidden");
                                currentFolderName = "";
                            }
                            loadHistory();
                        }
                    }
                });

                // Handle labels toggle
                div.querySelectorAll(".label-btn").forEach(lBtn => {
                    lBtn.addEventListener("click", async (e) => {
                        e.stopPropagation();
                        const labelType = lBtn.dataset.label;
                        const isCurrentlyActive = lBtn.classList.contains("active");
                        
                        const currentLabels = item.labels || { heart: false, star: false, save: false };
                        const newLabels = { ...currentLabels };
                        newLabels[labelType] = !isCurrentlyActive;

                        const res = await AppStorage.saveLabels(item.folder_name, newLabels);
                        if (res && res.success) {
                            lBtn.classList.toggle("active");
                            if (!item.labels) item.labels = {};
                            item.labels[labelType] = newLabels[labelType];
                            if (activeFilter !== "all" && !newLabels[labelType]) {
                                div.remove();
                            }
                        }
                    });
                });

                historyList.appendChild(div);
            });
        } else {
            historyList.innerHTML = `<p class="empty-history">ไม่มีโพสต์ที่วางแผนไว้ในระบบ</p>`;
        }
    }

    async function showPostPreview(data) {
        currentFolderName = data.folder_name;
        
        postNote.value = data.note || "";
        noteStatus.textContent = "";
        
        postScheduleTime.value = data.schedule_time || "";
        checkScheduleConflict(data.schedule_time || "");
        
        currentPostedState = data.posted || false;
        updatePostedBtnUI(currentPostedState);
        
        const isLocal = AppStorage.isLocal();
        if (isLocal) {
            saveLocation.textContent = `Location: ${data.folder_name}`;
            openFolderBtn.classList.remove("hidden");
            copyAllBtn.classList.remove("hidden");
        } else {
            saveLocation.textContent = `Offline PWA Mode (Saved on this phone)`;
            openFolderBtn.classList.add("hidden");
            copyAllBtn.classList.remove("hidden");
        }
        
        authorName.textContent = `@${data.username || "my_post"}`;
        authorAvatar.src = "https://static.cdninstagram.com/rsrc.php/y4/r/pctUncuduBn.svg";
        
        if (data.caption) {
            postCaption.textContent = data.caption;
            captionContainer.classList.remove("hidden");
        } else {
            postCaption.textContent = "No caption text.";
            captionContainer.classList.add("hidden");
        }
        
        mediaGallery.innerHTML = "";
        let filesList = [];
        if (data.media && Array.isArray(data.media)) {
            filesList = data.media;
        } else {
            filesList = [...(data.images || []), ...(data.videos || [])];
        }
        const videoFiles = filesList.filter(f => f.toLowerCase().endsWith(".mp4"));
        const imageFiles = filesList.filter(f => f.toLowerCase().endsWith(".jpg") || f.toLowerCase().endsWith(".jpeg") || f.toLowerCase().endsWith(".png"));
        
        const hasVideos = videoFiles.length > 0;
        const hasImages = imageFiles.length > 0;
        
        currentDownload = {
            folder_name: data.folder_name,
            images: imageFiles,
            videos: videoFiles,
            caption: data.caption || ""
        };
        
        if (hasVideos || hasImages) {
            mediaGallery.classList.remove("hidden");
            
            for (let i = 0; i < videoFiles.length; i++) {
                const f = videoFiles[i];
                const vidUrl = await AppStorage.getMediaUrl(data.folder_name, f);
                
                const wrapper = document.createElement("div");
                wrapper.className = "gallery-item-wrapper";
                
                const video = document.createElement("video");
                video.className = "gallery-video";
                video.controls = true;
                video.src = vidUrl;
                video.draggable = true;
                
                wrapper.appendChild(video);
                
                const actions = document.createElement("div");
                actions.className = "media-item-actions";
                
                if (isLocal) {
                    const copyBtn = document.createElement("button");
                    copyBtn.className = "copy-media-btn";
                    copyBtn.innerHTML = `<i class="fa-solid fa-copy"></i> Copy`;
                    copyBtn.addEventListener("click", async (e) => {
                        e.stopPropagation();
                        try {
                            const res = await fetch("/api/copy-to-clipboard", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ folder_name: data.folder_name, filenames: [f] })
                            });
                            const copyData = await res.json();
                            if (res.ok && copyData.success) {
                                copyBtn.innerHTML = `<i class="fa-solid fa-check"></i> Copied!`;
                                setTimeout(() => { copyBtn.innerHTML = `<i class="fa-solid fa-copy"></i> Copy`; }, 2000);
                            }
                        } catch (err) { console.error(err); }
                    });
                    actions.appendChild(copyBtn);
                } else {
                    const dlBtn = document.createElement("a");
                    dlBtn.className = "copy-media-btn btn";
                    dlBtn.href = vidUrl;
                    dlBtn.download = f;
                    dlBtn.innerHTML = `<i class="fa-solid fa-download"></i> Save`;
                    actions.appendChild(dlBtn);
                }
                wrapper.appendChild(actions);
                mediaGallery.appendChild(wrapper);
            }
            
            for (let i = 0; i < imageFiles.length; i++) {
                const f = imageFiles[i];
                const imgUrl = await AppStorage.getMediaUrl(data.folder_name, f);
                
                const wrapper = document.createElement("div");
                wrapper.className = "gallery-item-wrapper";
                
                const img = document.createElement("img");
                img.className = "gallery-image";
                img.src = imgUrl;
                img.draggable = true;
                
                wrapper.appendChild(img);
                
                const actions = document.createElement("div");
                actions.className = "media-item-actions";
                
                if (isLocal) {
                    const copyBtn = document.createElement("button");
                    copyBtn.className = "copy-media-btn";
                    copyBtn.innerHTML = `<i class="fa-solid fa-copy"></i> Copy`;
                    copyBtn.addEventListener("click", async (e) => {
                        e.stopPropagation();
                        try {
                            const res = await fetch("/api/copy-to-clipboard", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ folder_name: data.folder_name, filenames: [f] })
                            });
                            const copyData = await res.json();
                            if (res.ok && copyData.success) {
                                copyBtn.innerHTML = `<i class="fa-solid fa-check"></i> Copied!`;
                                setTimeout(() => { copyBtn.innerHTML = `<i class="fa-solid fa-copy"></i> Copy`; }, 2000);
                            }
                        } catch (err) { console.error(err); }
                    });
                    actions.appendChild(copyBtn);
                } else {
                    const dlBtn = document.createElement("a");
                    dlBtn.className = "copy-media-btn btn";
                    dlBtn.href = imgUrl;
                    dlBtn.download = f;
                    dlBtn.innerHTML = `<i class="fa-solid fa-download"></i> Save`;
                    actions.appendChild(dlBtn);
                }
                wrapper.appendChild(actions);
                mediaGallery.appendChild(wrapper);
            }
        } else {
            mediaGallery.classList.add("hidden");
        }
        
        commentsList.innerHTML = "";
        if (data.comments && data.comments.length > 0) {
            commentsCount.textContent = `(${data.comments.length})`;
            data.comments.forEach(c => {
                const div = document.createElement("div");
                div.className = "comment-item";
                div.innerHTML = `
                    <div class="comment-author-box">
                        <img src="${c.profile_pic || 'https://static.cdninstagram.com/rsrc.php/y4/r/pctUncuduBn.svg'}" class="comment-avatar" />
                        <span class="comment-username">@${c.username}</span>
                    </div>
                    <div class="comment-text" title="คลิกเพื่อคัดลอกคอมเมนต์">${c.text}</div>
                `;
                const textDiv = div.querySelector(".comment-text");
                textDiv.addEventListener("click", () => {
                    navigator.clipboard.writeText(c.text);
                    textDiv.classList.add("copied");
                    const originalText = textDiv.textContent;
                    textDiv.textContent = "คัดลอกคอมเมนต์แล้ว! (Copied!)";
                    setTimeout(() => {
                        textDiv.textContent = originalText;
                        textDiv.classList.remove("copied");
                    }, 1200);
                });
                commentsList.appendChild(div);
            });
        } else {
            commentsCount.textContent = "(0)";
            commentsList.innerHTML = `<p style="font-size: 0.8rem; color: var(--win-text-muted); text-align: center; margin-top: 10px; font-style: italic;">ไม่มีคอมเมนต์ประกอบ</p>`;
        }
        
        previewCard.classList.remove("hidden");
        
        if (window.innerWidth <= 768) {
            previewCard.scrollIntoView({ behavior: "smooth" });
        }
    }

    // Downloader submit form logic
    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        
        if (!AppStorage.isLocal()) {
            alert("⚠️ ระบบดาวน์โหลด Threads อัตโนมัติรองรับเฉพาะเมื่อเปิดใช้งานโปรแกรมบนคอมพิวเตอร์เท่านั้น\n\nหากใช้งานบนโทรศัพท์มือถือ คุณสามารถกดปุ่ม ➕ ในแถบด้านซ้าย เพื่อสร้างโพสต์และแนบรูป/วิดีโอด้วยตนเองได้ฟรีเลยครับ!");
            return;
        }

        const url = input.value.trim();
        if (!url) return;

        // Reset steps UI
        resetSteps();
        statusCard.classList.remove("hidden");
        errorCard.classList.add("hidden");
        previewCard.classList.add("hidden");
        submitBtn.disabled = true;

        try {
            setStepActive("connect");
            simulateProgress();

            const res = await fetch("/api/download", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    url: url,
                    include_comments: includeCommentsCheckbox.checked
                })
            });

            const data = await res.json();
            clearInterval(progressInterval);

            if (res.ok && data.success) {
                setStepCompleted("connect");
                setStepCompleted("fetch");
                setStepCompleted("parse");
                setStepCompleted("save");
                
                downloadedDirectory = data.download.directory;
                currentFolderName = data.download.folder_name;
                
                setTimeout(() => {
                    statusCard.classList.add("hidden");
                    loadHistory();
                    showPostPreview(data);
                }, 1000);
            } else {
                showError(data.error || "Failed to download post.");
            }
        } catch (err) {
            clearInterval(progressInterval);
            showError("Network error or server backend offline.");
            console.error(err);
        } finally {
            submitBtn.disabled = false;
        }
    });

    copyAllBtn.addEventListener("click", async () => {
        if (!currentDownload) return;
        
        if (AppStorage.isLocal()) {
            const files = [...(currentDownload.videos || []), ...(currentDownload.images || [])];
            try {
                const res = await fetch("/api/copy-to-clipboard", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ 
                        folder_name: currentDownload.folder_name, 
                        filenames: files,
                        caption: currentDownload.caption || ""
                    })
                });
                const data = await res.json();
                if (res.ok && data.success) {
                    const originalHtml = copyAllBtn.innerHTML;
                    copyAllBtn.innerHTML = `<i class="fa-solid fa-check"></i> <span>คัดลอกหมดแล้ว! (Copied All!)</span>`;
                    copyAllBtn.classList.add("copied");
                    setTimeout(() => {
                        copyAllBtn.innerHTML = originalHtml;
                        copyAllBtn.classList.remove("copied");
                    }, 2000);
                }
            } catch (err) { console.error(err); }
        } else {
            if (currentDownload.caption) {
                navigator.clipboard.writeText(currentDownload.caption);
                const originalHtml = copyAllBtn.innerHTML;
                copyAllBtn.innerHTML = `<i class="fa-solid fa-check"></i> <span>คัดลอกแคปชั่นแล้ว!</span>`;
                copyAllBtn.classList.add("copied");
                setTimeout(() => {
                    copyAllBtn.innerHTML = originalHtml;
                    copyAllBtn.classList.remove("copied");
                }, 2000);
            }
        }
    });

    openFolderBtn.addEventListener("click", async () => {
        if (!AppStorage.isLocal() || !currentDownload) return;
        try {
            await fetch("/api/open-folder", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ directory: currentDownload.folder_name })
            });
        } catch (err) { console.error(err); }
    });

    // Save Note Autocommit
    postNote.addEventListener("input", () => {
        if (!currentFolderName) return;
        noteStatus.textContent = "กำลังพิมพ์... (Typing...)";
        noteStatus.style.color = "var(--win-text-muted)";
        
        clearTimeout(autosaveTimeout);
        autosaveTimeout = setTimeout(async () => {
            const noteContent = postNote.value;
            const res = await AppStorage.saveNote(currentFolderName, noteContent);
            if (res && res.success) {
                noteStatus.textContent = "บันทึกโน้ตสำเร็จ (Note saved!)";
                noteStatus.style.color = "var(--success-green)";
                const activeItem = historyDataArray.find(h => h.folder_name === currentFolderName);
                if (activeItem) activeItem.note = noteContent;
            } else {
                noteStatus.textContent = "ล้มเหลวในการบันทึก (Error saving note)";
                noteStatus.style.color = "var(--error-red)";
            }
        }, 800);
    });

    saveNoteBtn.addEventListener("click", async () => {
        if (!currentFolderName) return;
        const noteContent = postNote.value;
        const res = await AppStorage.saveNote(currentFolderName, noteContent);
        if (res && res.success) {
            noteStatus.textContent = "บันทึกโน้ตสำเร็จ (Saved!)";
            noteStatus.style.color = "var(--success-green)";
            const activeItem = historyDataArray.find(h => h.folder_name === currentFolderName);
            if (activeItem) activeItem.note = noteContent;
        }
    });

    // Schedule updates
    postScheduleTime.addEventListener("change", async () => {
        if (!currentFolderName) return;
        const val = postScheduleTime.value;
        
        const res = await AppStorage.saveSchedule(currentFolderName, val, currentPostedState);
        if (res && res.success) {
            checkScheduleConflict(val);
            const activeItem = historyDataArray.find(h => h.folder_name === currentFolderName);
            if (activeItem) activeItem.schedule_time = val;
            
            scheduleStatus.innerHTML = `<span style="color: var(--success-green); font-weight: bold;"><i class="fa-solid fa-circle-check"></i> Saved successfully</span>`;
            scheduleStatus.classList.remove("hidden");
            
            setTimeout(() => {
                scheduleStatus.classList.add("hidden");
            }, 3000);
            
            updateAllCountdowns();
        } else {
            scheduleStatus.innerHTML = `<span style="color: var(--error-red); font-weight: bold;"><i class="fa-solid fa-triangle-exclamation"></i> Error saving</span>`;
            scheduleStatus.classList.remove("hidden");
        }
    });

    clearScheduleBtn.addEventListener("click", async () => {
        if (!currentFolderName) return;
        postScheduleTime.value = "";
        
        const res = await AppStorage.saveSchedule(currentFolderName, "", currentPostedState);
        if (res && res.success) {
            checkScheduleConflict("");
            const activeItem = historyDataArray.find(h => h.folder_name === currentFolderName);
            if (activeItem) activeItem.schedule_time = "";
            
            scheduleStatus.innerHTML = `<span style="color: var(--success-green); font-weight: bold;"><i class="fa-solid fa-circle-check"></i> Cleared successfully</span>`;
            scheduleStatus.classList.remove("hidden");
            
            setTimeout(() => {
                scheduleStatus.classList.add("hidden");
            }, 3000);
            
            updateAllCountdowns();
        }
    });

    togglePostedBtn.addEventListener("click", async () => {
        if (!currentFolderName) return;
        currentPostedState = !currentPostedState;
        
        const scheduleVal = postScheduleTime.value;
        const res = await AppStorage.saveSchedule(currentFolderName, scheduleVal, currentPostedState);
        if (res && res.success) {
            updatePostedBtnUI(currentPostedState);
            const activeItem = historyDataArray.find(h => h.folder_name === currentFolderName);
            if (activeItem) activeItem.posted = currentPostedState;
            updateAllCountdowns();
        }
    });

    function updatePostedBtnUI(isPosted) {
        if (isPosted) {
            togglePostedBtn.className = "btn btn-posted-active";
            togglePostedBtn.innerHTML = `<i class="fa-solid fa-circle-check"></i> ลงแล้ว (Posted)`;
        } else {
            togglePostedBtn.className = "btn btn-posted-inactive";
            togglePostedBtn.innerHTML = `<i class="fa-solid fa-circle"></i> ยังไม่ได้ลง (Ready to Post)`;
        }
    }

    // Modal Control: Calendar
    openCalendarBtn.addEventListener("click", () => {
        calendarModal.classList.remove("hidden");
        renderCalendar();
    });
    closeCalendarBtn.addEventListener("click", () => calendarModal.classList.add("hidden"));

    // Modal Control: Settings
    openSettingsBtn.addEventListener("click", async () => {
        if (AppStorage.isLocal()) {
            try {
                const response = await fetch("/api/settings");
                const data = await response.json();
                settingsDownloadsDir.value = data.downloads_dir || "";
            } catch (err) { console.error(err); }
        } else {
            settingsDownloadsDir.value = "N/A - Running in PWA Mode";
            settingsDownloadsDir.disabled = true;
        }
        settingsModal.classList.remove("hidden");
    });
    closeSettingsBtn.addEventListener("click", () => settingsModal.classList.add("hidden"));
    closeSettingsTitleBtn.addEventListener("click", () => settingsModal.classList.add("hidden"));

    saveSettingsBtn.addEventListener("click", async () => {
        if (!AppStorage.isLocal()) {
            settingsModal.classList.add("hidden");
            return;
        }
        try {
            const res = await fetch("/api/settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ downloads_dir: settingsDownloadsDir.value })
            });
            const data = await res.json();
            if (res.ok && data.success) {
                settingsModal.classList.add("hidden");
                loadHistory();
            } else {
                alert("Error saving settings");
            }
        } catch (err) { console.error(err); }
    });

    // Modal Control: Custom Post Creator
    openCreatorBtn.addEventListener("click", () => {
        creatorUsername.value = "my_post";
        creatorCaption.value = "";
        creatorNote.value = "";
        creatorPreviews.innerHTML = `<p style="font-size: 0.75rem; color: var(--win-text-muted); font-style: italic; width: 100%; text-align: center; line-height: 42px; margin: 0;">ยังไม่มีไฟล์แนบ (No attached files)</p>`;
        creatorFiles = [];
        creatorModal.classList.remove("hidden");
    });
    closeCreatorBtn.addEventListener("click", () => creatorModal.classList.add("hidden"));
    closeCreatorTitleBtn.addEventListener("click", () => creatorModal.classList.add("hidden"));

    // Drag and Drop handlers
    creatorDropzone.addEventListener("dragover", (e) => {
        e.preventDefault();
        creatorDropzone.style.borderColor = "var(--win-blue-start)";
        creatorDropzone.style.background = "var(--win-bg)";
    });

    creatorDropzone.addEventListener("dragleave", () => {
        creatorDropzone.style.borderColor = "var(--win-shadow)";
        creatorDropzone.style.background = "var(--win-input-bg)";
    });

    creatorDropzone.addEventListener("drop", (e) => {
        e.preventDefault();
        creatorDropzone.style.borderColor = "var(--win-shadow)";
        creatorDropzone.style.background = "var(--win-input-bg)";
        handleCreatorFiles(e.dataTransfer.files);
    });

    creatorDropzone.addEventListener("click", () => creatorFileInput.click());
    creatorFileInput.addEventListener("change", () => handleCreatorFiles(creatorFileInput.files));

    function handleCreatorFiles(files) {
        if (files.length === 0) return;
        
        if (creatorFiles.length === 0) {
            creatorPreviews.innerHTML = "";
        }

        Array.from(files).forEach(file => {
            const reader = new FileReader();
            reader.onload = (event) => {
                const base64Data = event.target.result;
                creatorFiles.push({
                    name: file.name,
                    type: file.type,
                    data: base64Data
                });

                const thumb = document.createElement("div");
                thumb.style.position = "relative";
                thumb.style.width = "48px";
                thumb.style.height = "48px";
                thumb.style.border = "1px solid var(--win-shadow)";
                thumb.style.background = "#000";

                if (file.type.startsWith("image/")) {
                    thumb.innerHTML = `<img src="${base64Data}" style="width: 100%; height: 100%; object-fit: cover;" />`;
                } else {
                    thumb.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#fff;font-size:0.75rem;"><i class="fa-solid fa-video"></i></div>`;
                }

                const delBtn = document.createElement("div");
                delBtn.innerHTML = "X";
                delBtn.style.cssText = "position:absolute;top:-4px;right:-4px;background:#f00;color:#fff;width:14px;height:14px;font-size:10px;font-weight:bold;display:flex;align-items:center;justify-content:center;border-radius:50%;cursor:pointer;border:1px solid #fff;line-height:1;";
                delBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    const idx = creatorFiles.findIndex(cf => cf.name === file.name);
                    if (idx !== -1) creatorFiles.splice(idx, 1);
                    thumb.remove();
                    if (creatorFiles.length === 0) {
                        creatorPreviews.innerHTML = `<p style="font-size: 0.75rem; color: var(--win-text-muted); font-style: italic; width: 100%; text-align: center; line-height: 42px; margin: 0;">ยังไม่มีไฟล์แนบ (No attached files)</p>`;
                    }
                });

                thumb.appendChild(delBtn);
                creatorPreviews.appendChild(thumb);
            };
            reader.readAsDataURL(file);
        });
    }

    saveCreatorBtn.addEventListener("click", async () => {
        const username = creatorUsername.value.trim();
        const caption = creatorCaption.value.trim();
        const note = creatorNote.value.trim();

        if (!username) {
            alert("กรุณากรอกชื่อผู้ใช้!");
            return;
        }

        saveCreatorBtn.disabled = true;
        saveCreatorBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> กำลังบันทึก...`;

        try {
            const res = await AppStorage.createPost({
                username: username,
                caption: caption,
                note: note
            }, creatorFiles);

            if (res && res.success) {
                creatorModal.classList.add("hidden");
                loadHistory();
            } else {
                alert("เกิดข้อผิดพลาดในการบันทึกโพสต์");
            }
        } catch (err) {
            console.error(err);
            alert("เซิร์ฟเวอร์หลังบ้านผิดพลาด");
        } finally {
            saveCreatorBtn.disabled = false;
            saveCreatorBtn.innerHTML = `<i class="fa-solid fa-save"></i> บันทึก (Save)`;
        }
    });

    // Random Post Selector
    randomPostBtn.addEventListener("click", () => {
        const greenCards = historyDataArray.filter(item => {
            const now = new Date();
            if (item.posted === true) return false;
            if (item.schedule_time) {
                const start = new Date(item.schedule_time);
                const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
                if (now < start || (now >= start && now < end)) {
                    return false;
                }
            }
            return true;
        });

        if (greenCards.length === 0) {
            alert("ไม่มีโพสต์กรอบสีเขียวที่พร้อมลงเลยครับ!");
            return;
        }

        const randomIndex = Math.floor(Math.random() * greenCards.length);
        const winner = greenCards[randomIndex];

        if (activeFilter !== "all") {
            const labels = winner.labels || { heart: false, star: false, save: false };
            if (!labels[activeFilter]) {
                activeFilter = "all";
                document.querySelectorAll(".filter-btn").forEach(b => {
                    b.classList.toggle("active", b.dataset.filter === "all");
                });
                renderHistoryList();
            }
        }

        showPostPreview(winner);
        
        const itemDiv = document.querySelector(`.history-item[data-folder-name='${winner.folder_name}']`);
        if (itemDiv) {
            itemDiv.scrollIntoView({ behavior: "smooth", block: "nearest" });
            itemDiv.style.backgroundColor = "rgba(0, 0, 128, 0.1)";
            setTimeout(() => { itemDiv.style.backgroundColor = ""; }, 1500);
        }
    });

    // Calendar Render Engine
    let currentCalDate = new Date();
    
    prevMonthBtn.addEventListener("click", () => {
        currentCalDate.setMonth(currentCalDate.getMonth() - 1);
        renderCalendar();
    });
    nextMonthBtn.addEventListener("click", () => {
        currentCalDate.setMonth(currentCalDate.getMonth() + 1);
        renderCalendar();
    });

    function renderCalendar() {
        const title = document.getElementById("calendar-month-title");
        const grid = document.getElementById("calendar-days-grid");
        
        const year = currentCalDate.getFullYear();
        const month = currentCalDate.getMonth();
        
        const monthNames = [
            "มกราคม (January)", "กุมภาพันธ์ (February)", "มีนาคม (March)", 
            "เมษายน (April)", "พฤษภาคม (May)", "มิถุนายน (June)", 
            "กรกฎาคม (July)", "สิงหาคม (August)", "กันยายน (September)", 
            "ตุลาคม (October)", "พฤศจิกายน (November)", "ธันวาคม (December)"
        ];
        
        title.textContent = `${monthNames[month]} ${year}`;
        grid.innerHTML = "";
        
        const firstDayIndex = new Date(year, month, 1).getDay();
        const totalDays = new Date(year, month + 1, 0).getDate();
        const prevMonthTotalDays = new Date(year, month, 0).getDate();

        for (let i = firstDayIndex; i > 0; i--) {
            const dayDiv = document.createElement("div");
            dayDiv.className = "calendar-day padding-day";
            dayDiv.innerHTML = `<span class="day-number">${prevMonthTotalDays - i + 1}</span>`;
            grid.appendChild(dayDiv);
        }

        for (let day = 1; day <= totalDays; day++) {
            const dayDiv = document.createElement("div");
            dayDiv.className = "calendar-day";
            dayDiv.innerHTML = `<span class="day-number">${day}</span><div class="day-posts-list"></div>`;
            
            const currentDayDateStr = `${year}-${String(month+1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            
            const scheduledPosts = historyDataArray.filter(item => {
                if (!item.schedule_time) return false;
                return item.schedule_time.startsWith(currentDayDateStr);
            });
            
            const listContainer = dayDiv.querySelector(".day-posts-list");
            scheduledPosts.forEach(post => {
                const pTag = document.createElement("div");
                pTag.className = "calendar-post-tag";
                pTag.style.cssText = "font-size:0.68rem; margin-top:2px; background:var(--win-blue-start); color:#fff; padding:1px 4px; border-radius:0px; text-overflow:ellipsis; overflow:hidden; white-space:nowrap; cursor:pointer;";
                pTag.textContent = `@${post.username || "my_post"}`;
                pTag.title = `คลิกเพื่อดูรายละเอียด: @${post.username} | ${post.schedule_time.split("T")[1] || ""}`;
                
                pTag.addEventListener("click", (e) => {
                    e.stopPropagation();
                    calendarModal.classList.add("hidden");
                    showPostPreview(post);
                });
                
                listContainer.appendChild(pTag);
            });
            
            grid.appendChild(dayDiv);
        }
        
        const totalRendered = firstDayIndex + totalDays;
        const tailPadding = 42 - totalRendered;
        for (let i = 1; i <= tailPadding; i++) {
            const dayDiv = document.createElement("div");
            dayDiv.className = "calendar-day padding-day";
            dayDiv.innerHTML = `<span class="day-number">${i}</span>`;
            grid.appendChild(dayDiv);
        }
    }

    // Modal Control: Backup Manager
    openBackupBtn.addEventListener("click", () => {
        renderExportListBox();
        backupModal.classList.remove("hidden");
    });
    closeBackupBtn.addEventListener("click", () => backupModal.classList.add("hidden"));
    closeBackupTitleBtn.addEventListener("click", () => backupModal.classList.add("hidden"));

    function renderExportListBox() {
        exportListBox.innerHTML = "";
        if (historyDataArray && historyDataArray.length > 0) {
            historyDataArray.forEach((item, idx) => {
                const row = document.createElement("div");
                row.className = "export-item-row";
                const mediaCount = item.media ? item.media.length : ((item.images ? item.images.length : 0) + (item.videos ? item.videos.length : 0));
                row.innerHTML = `
                    <label>
                        <input type="checkbox" class="export-checkbox" data-folder-name="${item.folder_name}" checked />
                        <span>${idx + 1}. @${item.username || "my_post"} (${mediaCount} สื่อ)</span>
                    </label>
                `;
                exportListBox.appendChild(row);
            });
        } else {
            exportListBox.innerHTML = `<p style="font-size: 0.75rem; color: var(--win-text-muted); text-align: center; margin-top: 50px;">ไม่มีข้อมูลคิวงานสำหรับการส่งออก</p>`;
        }
    }

    exportSelectAllBtn.addEventListener("click", () => {
        document.querySelectorAll(".export-checkbox").forEach(cb => cb.checked = true);
    });

    exportDeselectAllBtn.addEventListener("click", () => {
        document.querySelectorAll(".export-checkbox").forEach(cb => cb.checked = false);
    });

    exportBtn.addEventListener("click", async () => {
        const checkedCheckboxes = document.querySelectorAll(".export-checkbox:checked");
        if (checkedCheckboxes.length === 0) {
            alert("กรุณาเลือกโพสต์ที่ต้องการส่งออกอย่างน้อย 1 รายการ!");
            return;
        }

        exportBtn.disabled = true;
        exportBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> กำลังเตรียมไฟล์...`;

        try {
            const exportItems = [];
            for (const cb of checkedCheckboxes) {
                const folderName = cb.dataset.folderName;
                const post = historyDataArray.find(h => h.folder_name === folderName);
                if (post) {
                    const base64Media = {};
                    const mediaFiles = post.media || [...(post.images || []), ...(post.videos || [])];
                    if (mediaFiles && mediaFiles.length > 0) {
                        for (const filename of mediaFiles) {
                            if (AppStorage.isLocal()) {
                                try {
                                    const res = await fetch(`/downloads/${folderName}/${filename}`);
                                    const blob = await res.blob();
                                    const base64 = await convertBlobToBase64(blob);
                                    base64Media[filename] = base64;
                                } catch (e) { console.error("Local fetch failed", e); }
                            } else {
                                const blob = await AppStorage.getBlob(folderName, filename);
                                if (blob) {
                                    const base64 = await convertBlobToBase64(blob);
                                    base64Media[filename] = base64;
                                }
                            }
                        }
                    }
                    exportItems.push({
                        post: post,
                        mediaFiles: base64Media
                    });
                }
            }

            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportItems));
            const downloadAnchor = document.createElement("a");
            downloadAnchor.setAttribute("href", dataStr);
            downloadAnchor.setAttribute("download", `ThreadsSaver_Backup_${Date.now()}.json`);
            document.body.appendChild(downloadAnchor);
            downloadAnchor.click();
            downloadAnchor.remove();
        } catch (err) {
            console.error(err);
            alert("ล้มเหลวในการส่งออกข้อมูลสำรอง");
        } finally {
            exportBtn.disabled = false;
            exportBtn.innerHTML = `<i class="fa-solid fa-download"></i> ดาวน์โหลดไฟล์สำรอง (.json)`;
        }
    });

    function convertBlobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    importBtn.addEventListener("click", async () => {
        const file = importFileInput.files[0];
        if (!file) {
            alert("กรุณาเลือกไฟล์สำรอง .json เพื่อนำเข้าข้อมูล!");
            return;
        }

        importBtn.disabled = true;
        importBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> กำลังนำเข้า...`;

        try {
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const importedList = JSON.parse(e.target.result);
                    if (!Array.isArray(importedList)) {
                        throw new Error("Invalid format");
                    }

                    for (const item of importedList) {
                        const post = item.post;
                        const mediaFiles = item.mediaFiles || {};
                        
                        if (AppStorage.isLocal()) {
                            await fetch("/api/import-post", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ post: post, mediaFiles: mediaFiles })
                            });
                        } else {
                            await AppStorage.importPost(post, mediaFiles);
                        }
                    }

                    alert(`นำเข้าประวัติข้อมูลเรียบร้อยแล้ว จำนวน ${importedList.length} รายการ!`);
                    backupModal.classList.add("hidden");
                    importFileInput.value = "";
                    loadHistory();
                } catch (err) {
                    console.error(err);
                    alert("รูปแบบไฟล์ไม่ถูกต้อง หรือนำเข้าล้มเหลว");
                } finally {
                    importBtn.disabled = false;
                    importBtn.innerHTML = `<i class="fa-solid fa-upload"></i> นำเข้า (Import)`;
                }
            };
            reader.readAsText(file);
        } catch (err) {
            console.error(err);
            importBtn.disabled = false;
            importBtn.innerHTML = `<i class="fa-solid fa-upload"></i> นำเข้า (Import)`;
        }
    });

    // Modal Control: Help Manual
    openHelpBtn.addEventListener("click", () => helpModal.classList.remove("hidden"));
    closeHelpBtn.addEventListener("click", () => helpModal.classList.add("hidden"));
    closeHelpTitleBtn.addEventListener("click", () => helpModal.classList.add("hidden"));

    // Conflicts Checker
    function checkScheduleConflict(timeString) {
        scheduleWarning.classList.add("hidden");
        if (!timeString) return;
        
        const currentTargetTime = new Date(timeString).getTime();
        const conflicts = historyDataArray.filter(item => {
            if (item.folder_name === currentFolderName || !item.schedule_time) return false;
            const itemTime = new Date(item.schedule_time).getTime();
            return Math.abs(itemTime - currentTargetTime) < 24 * 60 * 60 * 1000;
        });
        
        if (conflicts.length > 0) {
            scheduleWarningText.innerHTML = `ตรวจพบช่วงเวลาลงวิดีโอชนกัน: โพสต์นี้ตั้งค่าเวลาลงห่างจากโพสต์ของคนอื่นน้อยกว่า 24 ชม. ทั้งหมด <strong>${conflicts.length} รายการ</strong> กรุณาเว้นระยะห่างเพื่อความปลอดภัย`;
            scheduleWarning.classList.remove("hidden");
        }
    }

    // Step Status Animations for Downloader
    function resetSteps() {
        [stepConnect, stepFetch, stepParse, stepSave].forEach(el => {
            el.className = "step-item step-pending";
            el.querySelector("i").className = "fa-regular fa-circle-play";
        });
    }

    function setStepActive(step) {
        let el = document.getElementById(`step-${step}`);
        if (el) {
            el.className = "step-item step-active";
            el.querySelector("i").className = "fa-solid fa-spinner fa-spin";
        }
    }

    function setStepCompleted(step) {
        let el = document.getElementById(`step-${step}`);
        if (el) {
            el.className = "step-item step-completed";
            el.querySelector("i").className = "fa-solid fa-circle-check";
        }
    }

    function simulateProgress() {
        let currentStep = 0;
        const steps = ["connect", "fetch", "parse", "save"];
        
        progressInterval = setInterval(() => {
            if (currentStep < steps.length - 1) {
                setStepCompleted(steps[currentStep]);
                currentStep++;
                setStepActive(steps[currentStep]);
            }
        }, 1800);
    }

    function showError(message) {
        errorMessage.textContent = message;
        errorCard.classList.remove("hidden");
        statusCard.classList.add("hidden");
    }

    // Realtime Border & Cooldown updates
    function updateAllCountdowns() {
        const now = new Date();
        
        if (postScheduleTime && postScheduleTime.value) {
            const previewStart = new Date(postScheduleTime.value);
            const previewEnd = new Date(previewStart.getTime() + 24 * 60 * 60 * 1000);
            previewCooldownInfo.style.display = "flex";
            
            if (now < previewStart) {
                const diffMs = previewStart - now;
                const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
                const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
                previewCooldownInfo.style.borderColor = "#ffb800";
                previewCooldownInfo.style.background = "rgba(255, 184, 0, 0.05)";
                previewCooldownText.style.color = "#ffb800";
                previewCooldownText.innerHTML = `รอดำเนินการ: เริ่มคูลดาวน์ 24 ชม. ในอีก <strong>${diffHrs} ชม. ${diffMins} น.</strong>`;
            } else if (now >= previewStart && now < previewEnd) {
                const diffMs = previewEnd - now;
                const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
                const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
                previewCooldownInfo.style.borderColor = "#ff4b72";
                previewCooldownInfo.style.background = "rgba(255, 75, 114, 0.05)";
                previewCooldownText.style.color = "#ff4b72";
                previewCooldownText.innerHTML = `สถานะคูลดาวน์: ห้ามลงซ้ำ เหลือเวลาอีก <strong>${diffHrs} ชม. ${diffMins} น.</strong>`;
            } else {
                previewCooldownInfo.style.borderColor = "var(--success-green)";
                previewCooldownInfo.style.background = "rgba(46, 196, 182, 0.05)";
                previewCooldownText.style.color = "var(--success-green)";
                previewCooldownText.innerHTML = `สถานะปลอดภัย: พ้นระยะ 24 ชม. แล้ว <strong>(ลงโพสต์ใหม่ได้ปกติ)</strong>`;
            }
        } else {
            if (previewCooldownInfo) previewCooldownInfo.style.display = "none";
        }

        const cards = document.querySelectorAll(".history-item");
        cards.forEach(c => {
            const folderName = c.dataset.folderName;
            const item = historyDataArray.find(h => h.folder_name === folderName);
            if (!item) return;
            
            c.classList.remove("posted", "ready-to-post", "scheduled-waiting");
            
            let stateClass = "ready-to-post";
            if (item.posted === true) {
                stateClass = "posted";
            } else if (item.schedule_time) {
                const start = new Date(item.schedule_time);
                const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
                if (now < start) {
                    stateClass = "scheduled-waiting";
                } else if (now >= start && now < end) {
                    stateClass = "posted";
                } else {
                    stateClass = "ready-to-post";
                }
            }
            c.classList.add(stateClass);
        });
    }
});
