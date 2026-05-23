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
        async function loadAccountingCSV() {
            try {
                const response = await fetch('/api/accounting-csv', { cache: 'no-store' });
                if (!response.ok) {
                    throw new Error(`server returned ${response.status}`);
                }

                const csv = await response.text();
                parseCSV(csv, 'accounting.csv');
            } catch (error) {
                showNotice(`Could not load accounting.csv. ${error.message}`, true);
            }
        }

        function parseCSV(csvText, sourceName = 'CSV') {
            const rows = parseCSVRobust(csvText);
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

            if (newTerms.length > 0) {
                terms = newTerms;
                clickedNode = null;
                focusedNode = null;
                rebuildTree();
                document.querySelector('.file-name').textContent = sourceName;
                showNotice(`Imported ${newTerms.length} term${newTerms.length === 1 ? '' : 's'} from ${sourceName}.`);
            } else {
                showNotice('No usable rows found. CSV needs term, definition, and branch columns.', true);
            }
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

        const svg = d3.select("#tree-container").append("svg")
            .attr("width", width)
            .attr("height", height);

        const zoom = d3.zoom()
            .scaleExtent([0.15, 4])
            .on("zoom", (event) => {
                g.attr("transform", event.transform);
            });

        svg.call(zoom);

        const g = svg.append("g");

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
            document.getElementById('accounting-button').addEventListener('click', loadAccountingCSV);
            document.getElementById('collapse-button').addEventListener('click', collapseAll);
            document.getElementById('reset-button').addEventListener('click', resetZoom);
            document.getElementById('clear-button').addEventListener('click', clearSelection);
        }

        // Center view on both root nodes - CLOSER ZOOM
        function centerOnRoots() {
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
        render();
        setTimeout(centerOnRoots, 50);
        loadAccountingCSV();

        // Resize
        window.addEventListener('resize', () => {
            const newWidth = treePanel.clientWidth;
            const newHeight = treePanel.clientHeight;
            svg.attr("width", newWidth).attr("height", newHeight);
            updateRootPositions();
            render();
            setTimeout(centerOnRoots, 100);
        });


