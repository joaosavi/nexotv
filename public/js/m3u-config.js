(function () {
    'use strict';

    const chipsContainer = document.getElementById('publicPlaylistChips');
    const m3uUrlInput    = document.getElementById('m3uUrl');

    function renderChips(playlists) {
        if (!chipsContainer || !m3uUrlInput || !Array.isArray(playlists)) return;
        playlists.forEach(({ label, note, url }) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'playlist-chip';
            btn.innerHTML = `<span class="chip-label">${label}</span><span class="chip-note">${note || ''}</span>`;
            btn.title = url;
            btn.addEventListener('click', () => {
                m3uUrlInput.value = url;
                m3uUrlInput.dispatchEvent(new Event('input'));
            });
            chipsContainer.appendChild(btn);
        });
    }

    if (chipsContainer && m3uUrlInput) {
        fetch('/api/public-playlists')
            .then(r => r.json())
            .then(renderChips)
            .catch(() => {});
    }

    const installBtn       = document.getElementById('installM3uBtn');
    const m3uEnableEpg     = document.getElementById('m3uEnableEpg');
    const m3uEpgOptions    = document.getElementById('m3uEpgOptions');
    const m3uCustomEpgGroup = document.getElementById('m3uCustomEpgGroup');

    function syncEpgOptionsVisibility() {
        if (!m3uEpgOptions) return;
        m3uEpgOptions.classList.toggle('hidden', !m3uEnableEpg.checked);
    }

    function syncCustomEpgVisibility() {
        if (!m3uCustomEpgGroup) return;
        const isCustom = document.querySelector('input[name="m3uEpgMode"]:checked')?.value === 'custom';
        m3uCustomEpgGroup.classList.toggle('hidden', !isCustom);
    }

    if (m3uEnableEpg) {
        m3uEnableEpg.addEventListener('change', syncEpgOptionsVisibility);
    }

    document.querySelectorAll('input[name="m3uEpgMode"]').forEach(radio => {
        radio.addEventListener('change', syncCustomEpgVisibility);
    });

    if (!installBtn) return;

    installBtn.addEventListener('click', async () => {
        const m3uUrl = document.getElementById('m3uUrl')?.value?.trim();
        if (!m3uUrl) {
            alert('Please enter a playlist URL.');
            return;
        }

        // Basic URL format validation before hitting the server
        try {
            new URL(m3uUrl);
        } catch {
            alert('Please enter a valid URL (must start with http:// or https://).');
            return;
        }

        const enableEpg      = !!document.getElementById('m3uEnableEpg')?.checked;
        const epgMode        = document.querySelector('input[name="m3uEpgMode"]:checked')?.value || 'auto';
        const customEpgUrl   = epgMode === 'custom'
            ? (document.getElementById('m3uCustomEpgUrl')?.value?.trim() || '')
            : '';
        const epgOffsetHours = parseFloat(document.getElementById('m3uEpgOffsetHours')?.value) || 0;
        const reformatLogos  = !!document.getElementById('m3uReformatLogos')?.checked;

        const config = {
            provider:  'm3u',
            m3uUrl,
            enableEpg,
            ...(enableEpg && epgOffsetHours !== 0 ? { epgOffsetHours } : {}),
            ...(enableEpg && customEpgUrl          ? { epgUrl: customEpgUrl } : {}),
            reformatLogos,
        };

        ConfigureCommon.showOverlay(false);
        ConfigureCommon.overlaySetMessage('Building M3U addon…');

        try {
            const { manifestUrl, stremioUrl } = await ConfigureCommon.buildUrls(config);

            const copyBtn = document.getElementById('copyManifestBtn');
            const openBtn = document.getElementById('openStremioBtn');
            if (copyBtn) copyBtn.href = manifestUrl;
            if (openBtn) openBtn.href = stremioUrl;

            ConfigureCommon.startPolling(10);
        } catch (e) {
            ConfigureCommon.hideOverlay();
            alert('Error generating addon URL: ' + e.message);
        }
    });

    // Prefill on reconfigure — called by configure-common.js via prefillIfReconfigure('m3u')
    // (visibility sync after programmatic state change is handled in configure-common.js)
})();
