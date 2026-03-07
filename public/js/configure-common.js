// Shared overlay and manifest polling logic
(function () {
    const overlay = document.getElementById('loaderOverlay');
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');
    const loaderMessage = document.getElementById('loaderMessage');
    const statusDetails = document.getElementById('statusDetails');
    const copyBtn = document.getElementById('copyManifestBtn');
    const openBtn = document.getElementById('openStremioBtn');

    // Constants
    const POLL_INTERVAL_MS = 1500;
    const MAX_WAIT_MS = 90000;
    const PROGRESS_ESTIMATE_MS = 45000;

    let pollTimer = null;
    let autoOpened = false;
    let manifestUrl = '';
    let stremioUrl = '';
    let startTime = 0;
    let manualPhase = false;
    let baselinePct = 0;
    let ready = false;



    function disableActionButtons() {
        if (openBtn) {
            openBtn.disabled = true;
            openBtn.classList.add('locked');
            openBtn.style.display = 'none'; // HIDE until ready

        }
        if (copyBtn) {
            copyBtn.disabled = true;
            copyBtn.classList.add('locked');
            copyBtn.style.display = 'none'; // HIDE until ready
        }
    }

    function enableActionButtons() {
        if (openBtn) {
            openBtn.disabled = false;
            openBtn.classList.remove('locked');
            openBtn.style.display = ''; // SHOW when ready
        }
        if (copyBtn) {
            copyBtn.disabled = false;
            copyBtn.classList.remove('locked');
            copyBtn.style.display = ''; // SHOW when ready
        }
    }

    function showOverlay(isManualPrePhase = false) {
        manualPhase = isManualPrePhase;
        if (overlay) overlay.classList.remove('hidden');
        setProgress(0, 'Initializing…');
        statusDetails && (statusDetails.textContent = '');
        autoOpened = false;
        ready = false;
        disableActionButtons(); // ALWAYS ensure disabled on open
    }

    function hideOverlay() {
        if (overlay) overlay.classList.add('hidden');
        if (pollTimer) clearTimeout(pollTimer);
    }

    function setProgress(pct, label) {
        if (progressBar) progressBar.style.width = Math.min(100, pct) + '%';
        if (progressText) progressText.textContent = `${Math.round(pct)}%`;
        if (label) loaderMessage.textContent = label;
    }

    function appendDetail(line) {
        if (!statusDetails) return;
        statusDetails.textContent += (statusDetails.textContent ? '\n' : '') + line;
        statusDetails.scrollTop = statusDetails.scrollHeight;
    }

    function progressMessage(elapsed) {
        if (elapsed < 4000) return 'Contacting Xtream panel…';
        if (elapsed < 10000) return 'Loading live channels…';
        if (elapsed < 18000) return 'Organizing categories…';
        if (elapsed < 26000) return 'Fetching EPG (if enabled)…';
        if (elapsed < 35000) return 'Parsing EPG data…';
        if (elapsed < 45000) return 'Finalizing manifest…';
        return 'Almost done…';
    }



    function attemptPoll() {
        if (manualPhase) return; // Pre-flight still running client-side
        if (ready) return;

        const elapsed = Date.now() - startTime;

        // Synthetic progress up to baseline + 95%
        if (progressBar && parseFloat(progressBar.style.width) < baselinePct + 95) {
            const synthetic = baselinePct + Math.min(95, (elapsed / PROGRESS_ESTIMATE_MS) * 95);
            setProgress(synthetic, progressMessage(elapsed));
        }

        fetch(manifestUrl + '?_=' + Date.now(), { cache: 'no-store' })
            .then(r => r.ok ? r.json() : Promise.reject(r.status))
            .then(json => {
                if (json && json.id) {
                    ready = true;
                    setProgress(100, 'Ready');
                    appendDetail('Manifest ready.');
                    enableActionButtons(); // ENABLE ONLY HERE
                    // Inject a Close button (success case) if not already present
                    try {
                        const status = document.getElementById('statusDetails');
                        if (status && !document.getElementById('successCloseBtn')) {
                            const btn = document.createElement('button');
                            btn.id = 'successCloseBtn';
                            btn.textContent = 'Close';
                            btn.className = 'btn secondary';
                            btn.style.marginTop = '14px';
                            btn.addEventListener('click', hideOverlay);
                            status.parentElement.appendChild(btn);
                        }
                    } catch (e) { /* ignore DOM injection errors */ }
                    if (!autoOpened) {
                        autoOpened = true;
                        // Do not force-open if user might want to copy first.
                        // To auto-open uncomment next line:
                        // window.location.href = stremioUrl;
                    }
                    if (pollTimer) clearTimeout(pollTimer);
                    return;
                }
                scheduleNext(elapsed);
            })
            .catch(() => scheduleNext(elapsed));
    }

    function scheduleNext(elapsed) {
        if (ready) return;
        if (elapsed > MAX_WAIT_MS) {
            loaderMessage.textContent = 'Taking longer than expected.';
            appendDetail('Timeout waiting for manifest. You may retry or open later.');
            setProgress(100, 'Timeout');
            // Still allow user to copy / open after timeout
            enableActionButtons();
            return;
        }
        pollTimer = setTimeout(attemptPoll, POLL_INTERVAL_MS);
    }

    function startPolling(startPct = 50) {
        baselinePct = startPct;
        manualPhase = false;
        startTime = Date.now();
        disableActionButtons(); // Ensure still disabled when entering polling
        attemptPoll();
    }



    function copyManifest() {
        if (!manifestUrl || copyBtn.disabled) return;
        navigator.clipboard.writeText(manifestUrl)
            .then(() => {
                const old = copyBtn.textContent;
                copyBtn.textContent = 'Copied!';
                setTimeout(() => copyBtn.textContent = old, 1600);
            })
            .catch(() => {
                const old = copyBtn.textContent;
                copyBtn.textContent = 'Copy Failed';
                setTimeout(() => copyBtn.textContent = old, 1600);
            });
    }

    function openInStremio() {
        if (!stremioUrl || openBtn.disabled) return;
        window.location.href = stremioUrl;
    }

    if (copyBtn) copyBtn.addEventListener('click', copyManifest);
    if (openBtn) openBtn.addEventListener('click', openInStremio);



    function encodeConfigBase64Url(config) {
        const json = JSON.stringify(config);
        let b64 = btoa(unescape(encodeURIComponent(json)));
        return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    }

    async function buildUrls(config) {
        let token = '';
        try {
            const res = await fetch('/encrypt', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config)
            });
            if (res.ok) {
                const data = await res.json();
                token = data.token;
                appendDetail('✔ Config securely encrypted');
            } else {
                appendDetail(`⚠ Encryption unavailable (HTTP ${res.status}). Falling back to Base64 (Not Secure).`);
                token = encodeConfigBase64Url(config);
            }
        } catch (e) {
            appendDetail(`⚠ Encryption error (${e.message}). Falling back to Base64.`);
            token = encodeConfigBase64Url(config);
        }

        const origin = window.location.origin;
        manifestUrl = `${origin}/${token}/manifest.json`;
        const hostPart = origin.replace(/^https?:\/\//, '');
        stremioUrl = `stremio://${hostPart}/${token}/manifest.json`;
        return { token, manifestUrl, stremioUrl };
    }


    function getDecodedToken() {
        try {
            const parts = window.location.pathname.split('/').filter(Boolean);
            if (parts.length < 2) return null;
            const lastPart = parts[parts.length - 1];
            if (!lastPart.startsWith('configure')) return null;
            const token = parts[parts.length - 2];
            if (!token) return null;

            let decoded = null;
            try {
                let b64 = token.replace(/-/g, '+').replace(/_/g, '/');
                while (b64.length % 4) b64 += '=';
                const json = decodeURIComponent(escape(atob(b64)));
                decoded = JSON.parse(json);
            } catch {
                // encrypted token — cannot decode client-side
            }
            return decoded;
        } catch {
            return null;
        }
    }

    function prefillIfReconfigure(provider) {
        const decoded = getDecodedToken();
        if (!decoded) return;
        if (decoded.provider !== provider && !(provider === 'xtream' && !decoded.provider)) return;

        const tabId = provider === 'xtream' ? 'panel-xtream' : 'panel-iptv-org';
        const tabBtns = document.querySelectorAll('.tab-btn[role="tab"]');
        const tabPanels = document.querySelectorAll('.tab-panel[role="tabpanel"]');
        tabBtns.forEach(btn => {
            const isTarget = btn.getAttribute('aria-controls') === tabId;
            btn.classList.toggle('active', isTarget);
            btn.setAttribute('aria-selected', isTarget ? 'true' : 'false');
        });
        tabPanels.forEach(panel => {
            const isTarget = panel.id === tabId;
            panel.classList.toggle('active', isTarget);
            panel.classList.toggle('hidden', !isTarget);
        });

        if (provider === 'xtream') {
            const trySet = (id, val) => {
                const el = document.getElementById(id);
                if (el && val !== undefined && val !== null) el.value = val;
            };
            trySet('xtreamUrl', decoded.xtreamUrl);
            trySet('xtreamUsername', decoded.xtreamUsername);
            if (decoded.xtreamPassword) {
                const pwd = document.getElementById('xtreamPassword');
                if (pwd) {
                    pwd.value = '********';
                    pwd.dataset.original = decoded.xtreamPassword;
                }
            }
            const enableEpg = document.getElementById('enableEpg');
            if (enableEpg) enableEpg.checked = !!decoded.enableEpg;
            if (decoded.epgUrl) {
                const custom = document.querySelector('input[name="epgMode"][value="custom"]');
                if (custom) custom.checked = true;
                trySet('customEpgUrl', decoded.epgUrl);
            }
            trySet('epgOffsetHours', decoded.epgOffsetHours);
            const reformatLogos = document.getElementById('reformatLogos');
            if (reformatLogos) reformatLogos.checked = !!decoded.reformatLogos;
        }
    }

    window.ConfigureCommon = {
        showOverlay,
        hideOverlay,
        startPolling,
        buildUrls,
        overlaySetMessage(msg) { loaderMessage.textContent = msg; },
        setProgress,
        appendDetail,
        forceDisableActions: disableActionButtons,
        prefillIfReconfigure,
        getDecodedToken,
    };
})();