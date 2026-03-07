(function () {
    'use strict';

    const tabBtns = document.querySelectorAll('.tab-btn[role="tab"]');
    const tabPanels = document.querySelectorAll('.tab-panel[role="tabpanel"]');

    function activateTab(targetId) {
        tabBtns.forEach(btn => {
            const isTarget = btn.getAttribute('aria-controls') === targetId;
            btn.classList.toggle('active', isTarget);
            btn.setAttribute('aria-selected', isTarget ? 'true' : 'false');
        });
        tabPanels.forEach(panel => {
            const isTarget = panel.id === targetId;
            panel.classList.toggle('active', isTarget);
            panel.classList.toggle('hidden', !isTarget);
        });
    }

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.getAttribute('aria-controls');
            if (target) activateTab(target);
        });
    });

    const IPTV_ORG_BASE = 'https://iptv-org.github.io/api';

    function capitalize(s) {
        if (!s) return s;
        return s.charAt(0).toUpperCase() + s.slice(1);
    }

    function buildSearchableSelect({ inputId, hiddenId, listId, items, placeholder }) {
        const input = document.getElementById(inputId);
        const hidden = document.getElementById(hiddenId);
        const list = document.getElementById(listId);

        if (!input || !hidden || !list) return;

        input.placeholder = placeholder || 'Search…';

        function renderItems(filter) {
            const q = (filter || '').toLowerCase().trim();
            list.innerHTML = '';

            const filtered = q
                ? items.filter(it => it.label.toLowerCase().includes(q))
                : items;

            if (filtered.length === 0) {
                const li = document.createElement('li');
                li.textContent = 'No results';
                li.className = 'ss-no-results';
                list.appendChild(li);
                return;
            }

            filtered.forEach((it, i) => {
                const li = document.createElement('li');
                li.textContent = it.label;
                li.setAttribute('data-value', it.value ?? '');
                li.setAttribute('role', 'option');
                li.id = `${listId}-opt-${i}`;
                li.addEventListener('mousedown', e => {
                    e.preventDefault();
                    selectItem(it);
                });
                list.appendChild(li);
            });
        }

        function selectItem(it) {
            input.value = it.value ? it.label : '';
            hidden.value = it.value ?? '';
            closeDropdown();
        }

        function openDropdown() {
            renderItems(input.value);
            list.classList.remove('hidden');
            input.setAttribute('aria-expanded', 'true');
        }

        function closeDropdown() {
            list.classList.add('hidden');
            input.setAttribute('aria-expanded', 'false');
        }

        input.addEventListener('focus', () => openDropdown());
        input.addEventListener('input', () => {
            hidden.value = '';
            renderItems(input.value);
            list.classList.remove('hidden');
        });
        input.addEventListener('blur', () => {
            setTimeout(closeDropdown, 150);
        });

        input.addEventListener('keydown', e => {
            const opts = [...list.querySelectorAll('li:not(.ss-no-results)')];
            const highlighted = list.querySelector('li.highlighted');
            let idx = opts.indexOf(highlighted);

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (list.classList.contains('hidden')) openDropdown();
                idx = Math.min(idx + 1, opts.length - 1);
                opts.forEach(o => o.classList.remove('highlighted'));
                if (opts[idx]) opts[idx].classList.add('highlighted');
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                idx = Math.max(idx - 1, 0);
                opts.forEach(o => o.classList.remove('highlighted'));
                if (opts[idx]) opts[idx].classList.add('highlighted');
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (highlighted) {
                    const val = highlighted.getAttribute('data-value');
                    const label = highlighted.textContent;
                    selectItem({ label, value: val });
                }
            } else if (e.key === 'Escape') {
                closeDropdown();
            }
        });

        renderItems('');

        return { selectItem, renderItems };
    }

    let countriesLoaded = [];
    let categoriesLoaded = [];

    async function loadIptvOrgData() {
        try {
            const [countriesRaw, categoriesRaw] = await Promise.all([
                fetch(`${IPTV_ORG_BASE}/countries.json`).then(r => r.json()),
                fetch(`${IPTV_ORG_BASE}/categories.json`).then(r => r.json()),
            ]);

            const countryItems = [{ label: 'All Countries', value: '' }];
            const sorted = [...countriesRaw].sort((a, b) => a.name.localeCompare(b.name));
            sorted.forEach(c => {
                countryItems.push({ label: `${c.name} (${c.code.toUpperCase()})`, value: c.code.toUpperCase() });
            });
            countriesLoaded = countryItems;

            const categoryItems = [{ label: 'All Categories', value: '' }];
            const sortedCats = [...categoriesRaw].sort((a, b) => a.name.localeCompare(b.name));
            sortedCats.forEach(c => {
                categoryItems.push({ label: capitalize(c.name), value: c.id });
            });
            categoriesLoaded = categoryItems;

            buildSearchableSelect({
                inputId: 'iptvOrgCountryInput',
                hiddenId: 'iptvOrgCountry',
                listId: 'iptvOrgCountryList',
                items: countriesLoaded,
                placeholder: 'All Countries (search to filter…)',
            });

            buildSearchableSelect({
                inputId: 'iptvOrgCategoryInput',
                hiddenId: 'iptvOrgCategory',
                listId: 'iptvOrgCategoryList',
                items: categoriesLoaded,
                placeholder: 'All Categories (search to filter…)',
            });

            tryPrefillIptvOrg();

        } catch (err) {
            console.error('[IPTV-ORG] Failed to load countries/categories', err);
            const hint = document.querySelector('#panel-iptv-org .hint');
            if (hint) hint.textContent = '⚠ Could not load channel list from iptv-org. Check your connection.';
        }
    }

    function tryPrefillIptvOrg() {
        if (!window.ConfigureCommon || typeof window.ConfigureCommon.getDecodedToken !== 'function') return;
        const decoded = window.ConfigureCommon.getDecodedToken();
        if (!decoded || decoded.provider !== 'iptv-org') return;

        activateTab('panel-iptv-org');

        if (decoded.iptvOrgCountry) {
            const match = countriesLoaded.find(c => c.value === decoded.iptvOrgCountry.toUpperCase());
            if (match) {
                document.getElementById('iptvOrgCountryInput').value = match.label;
                document.getElementById('iptvOrgCountry').value = match.value;
            }
        }

        if (decoded.iptvOrgCategory) {
            const match = categoriesLoaded.find(c => c.value === decoded.iptvOrgCategory.toLowerCase());
            if (match) {
                document.getElementById('iptvOrgCategoryInput').value = match.label;
                document.getElementById('iptvOrgCategory').value = match.value;
            }
        }
    }

    const form = document.getElementById('iptvOrgForm');
    if (!form) {
        console.error('[IPTV-ORG] #iptvOrgForm not found');
    } else {
        form.addEventListener('submit', async e => {
            e.preventDefault();

            const { showOverlay, forceDisableActions, overlaySetMessage, setProgress,
                appendDetail, buildUrls, startPolling, hideOverlay } = window.ConfigureCommon || {};

            if (!window.ConfigureCommon) {
                console.error('[IPTV-ORG] ConfigureCommon not loaded');
                return;
            }

            const country = document.getElementById('iptvOrgCountry').value.trim() || null;
            const category = document.getElementById('iptvOrgCategory').value.trim() || null;

            showOverlay(true);
            forceDisableActions && forceDisableActions();
            overlaySetMessage('Preparing IPTV-org configuration…');
            setProgress(5, 'Starting');
            appendDetail('== PRE-FLIGHT (IPTV-ORG) ==');
            appendDetail(`Country filter: ${country || '(all)'}`);
            appendDetail(`Category filter: ${category || '(all)'}`);
            appendDetail('Note: channel data will be fetched & cached on first access (may take a few seconds).');

            try {
                const config = {
                    provider: 'iptv-org',
                    iptvOrgCountry: country,
                    iptvOrgCategory: category,
                };

                setProgress(40, 'Building token');
                const { manifestUrl } = await buildUrls(config);
                appendDetail('✔ Token built');
                appendDetail('Manifest URL: ' + manifestUrl);

                setProgress(70, 'Waiting for manifest');
                appendDetail('== SERVER BUILD PHASE ==');
                appendDetail('Polling server…');
                startPolling(70);

            } catch (err) {
                console.error('[IPTV-ORG] Submit error', err);
                overlaySetMessage('Configuration failed');
                appendDetail('✖ Error: ' + (err.message || err.toString()));
                setProgress(100, 'Failed');
                appendDetail('Close overlay and try again.');

                const status = document.getElementById('statusDetails');
                if (status && !document.getElementById('retryCloseIptvOrgBtn')) {
                    const btn = document.createElement('button');
                    btn.id = 'retryCloseIptvOrgBtn';
                    btn.textContent = 'Close';
                    btn.className = 'btn ghost';
                    btn.style.marginTop = '14px';
                    btn.onclick = hideOverlay;
                    status.parentElement.appendChild(btn);
                }
            }
        });
    }

    loadIptvOrgData();
})();
