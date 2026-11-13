const API_BASE = "";

let allFeatures = [];
let districtById = {};
let years = [];
let kraiAvgByYear = {};
let kraiKolByYear = {};

let currentYear = 2025;
let selectedFid = "all";
let compareFid = "none";
let activeLegendBin = null;

const map = L.map("map", { attributionControl: false }).setView([45.15, 39.1], 7);

L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    referrerPolicy: "strict-origin-when-cross-origin"
}).addTo(map);

const distSelect = document.getElementById("district-select");
const compSelect = document.getElementById("compare-select");
const yearFromSel = document.getElementById("year-from");
const yearToSel = document.getElementById("year-to");
const yearSelect = document.getElementById("year-select");

let geoLayer = null;
let badgeMarkers = [];
let labelMarkers = [];
let layerByFidMap = {};

function triggerAdminUpload() {
    document.getElementById("hidden-excel-input").click();
}
async function uploadNewExcel(event) {
    const file = event.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    try {
        const res = await fetch(`${API_BASE}/api/upload-excel`, { method: "POST", body: formData });
        const data = await res.json();
        if (res.ok) {
            alert("✅ " + data.message);
            loadDataFromBackend();
        } else {
            alert("Ошибка обновления БД: " + data.detail);
        }
    } catch (e) {
        alert("Ошибка соединения с сервером");
    }
}

function switchChartTab(tabId, btnEl) {
    document.querySelectorAll(".c-tab").forEach(b => b.classList.remove("active"));
    btnEl.classList.add("active");
    document.getElementById("chart-pane-main").style.display = tabId === "main" ? "flex" : "none";
    document.getElementById("chart-pane-dev").style.display = tabId === "dev" ? "flex" : "none";
    document.getElementById("chart-pane-scatter").style.display = tabId === "scatter" ? "flex" : "none";
}

let methodExpanded = true;
function toggleMethodBody() {
    methodExpanded = !methodExpanded;
    document.getElementById("method-body").style.display = methodExpanded ? "block" : "none";
    document.getElementById("method-btn").innerText = methodExpanded ? "Свернуть ▼" : "Развернуть ▲";
}
function closeMethodBanner() {
    document.getElementById("method-banner").style.display = "none";
}
function closeDistrictCard() {
    document.getElementById("district-popup-card").style.display = "none";
}

let insightExpanded = true;
function toggleInsightBody() {
    insightExpanded = !insightExpanded;
    document.getElementById("auto-insight-text").style.display = insightExpanded ? "block" : "none";
    document.getElementById("insight-toggle-lbl").innerText = insightExpanded ? "Свернуть ▲" : "Развернуть ▼";
}

function getNeighborsAvg(fid, year) {
    const d = districtById[fid];
    if (!d || !d.neighbors || !d.neighbors.length) return null;
    const vals = d.neighbors
        .map(nfid => districtById[nfid]?.avg[year])
        .filter(v => v !== null && v !== undefined);
    return vals.length ? +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : null;
}

function getPearsonCorr(fid) {
    const pYears = getSelectedPeriodYears();
    const pairs = [];
    pYears.forEach(y => {
        const k = fid === "all" ? kraiKolByYear[y] : districtById[fid]?.kol[y];
        const a = fid === "all" ? kraiAvgByYear[y] : districtById[fid]?.avg[y];
        if (k !== null && k !== undefined && a !== null && a !== undefined) pairs.push([k, a]);
    });
    if (pairs.length < 3) return null;
    const n = pairs.length;
    const meanX = pairs.reduce((s, p) => s + p[0], 0) / n;
    const meanY = pairs.reduce((s, p) => s + p[1], 0) / n;
    let num = 0, denX = 0, denY = 0;
    pairs.forEach(([x, y]) => {
        num += (x - meanX) * (y - meanY);
        denX += (x - meanX) ** 2;
        denY += (y - meanY) ** 2;
    });
    if (denX === 0 || denY === 0) return 0;
    return +(num / Math.sqrt(denX * denY)).toFixed(2);
}

function generateAutoInsight(fid) {
    const y1 = Math.min(parseInt(yearFromSel.value), parseInt(yearToSel.value));
    const y2 = Math.max(parseInt(yearFromSel.value), parseInt(yearToSel.value));
    const r = getPearsonCorr(fid);
    const rText = r !== null
        ? (r < -0.4 ? `Отмечается обратная корреляция (r = ${r}): расширение контингента сопровождается снижением среднего балла.`
           : r > 0.4 ? `Наблюдается прямая связь (r = ${r}): рост числа сдающих идет параллельно с ростом качества подготовки.`
           : `Статистическая зависимость балла от массовости экзамена слабая (r = ${r}).`)
        : "";

    if (fid === "all") {
        const kDyn = +(kraiAvgByYear[y2] - kraiAvgByYear[y1]).toFixed(1);
        const aboveCnt = Object.values(districtById).filter(d => d.avg[currentYear] >= kraiAvgByYear[currentYear]).length;
        return `В ${currentYear} г. среднекраевой балл составил ${kraiAvgByYear[currentYear]} б. (${aboveCnt} из 44 МО превышают региональную норму). За ${y1}–${y2} гг. общая динамика края составила ${kDyn > 0 ? "+" : ""}${kDyn} б. ${rText}`;
    }

    const d = districtById[fid];
    const typ = getTypology(fid).name;
    const dynA = getDynAvg(fid);
    const spread = getSpread(fid);
    const nAvg = getNeighborsAvg(fid, currentYear);
    const curAvg = d.avg[currentYear];
    let nText = "";
    if (nAvg && curAvg) {
        const diffN = +(curAvg - nAvg).toFixed(1);
        nText = `По отношению к граничащим районам (${nAvg} б.) результат ${diffN >= 0 ? "выше на +" + diffN : "ниже на " + diffN} б.`;
    }
    return `По итогам ${y1}–${y2} гг. ${d.name} относится к категории «${typ}» (динамика ${dynA > 0 ? "+" : ""}${dynA} б., размах ${spread} б.). ${nText} ${rText}`;
}

function updateDistrictBottomCard(fid) {
    const card = document.getElementById("district-popup-card");
    if (fid === "all" || !districtById[fid]) {
        card.style.display = "none";
        return;
    }
    const d = districtById[fid];
    const y1 = Math.min(parseInt(yearFromSel.value), parseInt(yearToSel.value));
    const y2 = Math.max(parseInt(yearFromSel.value), parseInt(yearToSel.value));
    const avg = d.avg[currentYear] ?? "нет данных";
    const kol = d.kol[currentYear] ?? "нет данных";
    const dAvg = getDynAvg(fid);
    const spread = getSpread(fid);
    const typ = getTypology(fid);
    const nAvg = getNeighborsAvg(fid, currentYear);

    document.getElementById("fc-district-title").innerText = `📍 ${d.name}`;
    document.getElementById("fc-district-body").innerHTML = `
        <div style="font-weight:600; color:${typ.color === '#fee08b' ? '#b45309' : typ.color}; margin-bottom:4px;">${typ.name}</div>
        <div class="fc-grid">
            <div>Ср. балл (${currentYear}): <b>${avg}</b></div>
            <div>Участников (${currentYear}): <b>${kol} чел.</b></div>
            <div>Динамика (${y1}–${y2}): <b>${dAvg > 0 ? "+" + dAvg : dAvg} б.</b></div>
            <div>Ср. балл соседей: <b>${nAvg ? nAvg + " б." : "—"}</b></div>
        </div>
    `;
    card.style.display = "block";
}

function updateMethodBanner(mode) {
    const banner = document.getElementById("method-banner");
    const title = document.getElementById("method-title");
    const body = document.getElementById("method-body");
    const y1 = Math.min(parseInt(yearFromSel.value), parseInt(yearToSel.value));
    const y2 = Math.max(parseInt(yearFromSel.value), parseInt(yearToSel.value));

    if (mode === "typology") {
        banner.style.display = "block";
        title.innerText = "ℹ️ Методология: Типология МО";
        body.innerHTML = `Классификация по динамике балла и участников (${y1}–${y2} гг.):
            <ul>
                <li><b style="color:#1a9850;">Тип 1 (Устойчивый рост):</b> Рост уч. (>0) и рост балла (>+5 б.).</li>
                <li><b style="color:#e67e22;">Тип 2 (Рост уч. при сниж. балла):</b> Рост уч. (>+5) при снижении балла (<-3 б.).</li>
                <li><b style="color:#3498db;">Тип 3 (Сниж. уч. при росте балла):</b> Сокращение уч. при росте балла (>+5 б.).</li>
                <li><b style="color:#d35400;">Тип 4 (Стабильность):</b> Колебания в пределах ±5.</li>
            </ul>`;
    } else if (mode === "stability") {
        banner.style.display = "block";
        title.innerText = "ℹ️ Методология: Устойчивость результатов";
        body.innerHTML = `Оценка волатильности через <b>размах колебаний</b> ($R = Max - Min$ за ${y1}–${y2} гг.):
            <ul>
                <li><b style="color:#2ecc71;">Стабильные (< 7 б.):</b> Устойчивая образовательная среда.</li>
                <li><b style="color:#f1c40f;">Средние (7–15 б.):</b> Умеренные межгодовые колебания.</li>
                <li><b style="color:#e74c3c;">Нестабильные (> 15 б.):</b> Резкие перепады среднего балла.</li>
            </ul>`;
    } else {
        banner.style.display = "none";
    }
}

function setupYearSelect() {
    yearSelect.innerHTML = "";
    years.forEach(y => yearSelect.add(new Option(y + " год", y)));
    yearSelect.value = currentYear;
}

async function loadDataFromBackend() {
    try {
        const res = await fetch(`${API_BASE}/api/data`);
        const data = await res.json();

        years = data.years;
        allFeatures = data.geojson.features;
        districtById = {};
        allFeatures.forEach(f => { districtById[f.properties.fid] = f.properties; });

        kraiAvgByYear = {};
        kraiKolByYear = {};
        data.benchmarks.forEach(b => {
            kraiAvgByYear[b.year] = b.krai_avg_score;
            kraiKolByYear[b.year] = b.total_participants;
        });

        currentYear = years[years.length - 1];
        setupYearSelect();

        yearFromSel.innerHTML = "";
        yearToSel.innerHTML = "";
        years.forEach(y => {
            yearFromSel.add(new Option(y, y));
            yearToSel.add(new Option(y, y));
        });
        yearFromSel.value = years[0];
        yearToSel.value = years[years.length - 1];

        distSelect.innerHTML = '<option value="all">📊 Весь Краснодарский край</option>';
        compSelect.innerHTML = '<option value="none">— нет —</option>';
        const expDist = document.getElementById("exp-district");
        const expComp = document.getElementById("exp-compare");
        expDist.innerHTML = '<option value="all">📊 Весь Краснодарский край</option>';
        expComp.innerHTML = '<option value="none">— без сравнения —</option>';

        [...allFeatures]
            .sort((a, b) => a.properties.name.localeCompare(b.properties.name))
            .forEach(f => {
                const p = f.properties;
                distSelect.add(new Option(p.name, p.fid));
                compSelect.add(new Option(p.name, p.fid));
                expDist.add(new Option(p.name, p.fid));
                expComp.add(new Option(p.name, p.fid));
            });

        selectDistrict("all", true);
    } catch (err) {
        console.error(err);
    }
}

function getSelectedPeriodYears() {
    const y1 = Math.min(parseInt(yearFromSel.value), parseInt(yearToSel.value));
    const y2 = Math.max(parseInt(yearFromSel.value), parseInt(yearToSel.value));
    return years.filter(y => y >= y1 && y <= y2);
}

function findNearestValid(obj, targetY, dir) {
    if (obj[targetY] !== null && obj[targetY] !== undefined) return obj[targetY];
    const sortedY = dir > 0 ? [...years] : [...years].reverse();
    for (let y of sortedY) {
        if (obj[y] !== null && obj[y] !== undefined) return obj[y];
    }
    return null;
}
function getDynAvg(fid) {
    const y1 = Math.min(parseInt(yearFromSel.value), parseInt(yearToSel.value));
    const y2 = Math.max(parseInt(yearFromSel.value), parseInt(yearToSel.value));
    const d = districtById[fid];
    const v1 = d.avg[y1] ?? findNearestValid(d.avg, y1, 1);
    const v2 = d.avg[y2] ?? findNearestValid(d.avg, y2, -1);
    return (v1 !== null && v2 !== null) ? +(v2 - v1).toFixed(1) : 0;
}
function getDynKol(fid) {
    const y1 = Math.min(parseInt(yearFromSel.value), parseInt(yearToSel.value));
    const y2 = Math.max(parseInt(yearFromSel.value), parseInt(yearToSel.value));
    const d = districtById[fid];
    const v1 = d.kol[y1] ?? findNearestValid(d.kol, y1, 1);
    const v2 = d.kol[y2] ?? findNearestValid(d.kol, y2, -1);
    return (v1 !== null && v2 !== null) ? (v2 - v1) : 0;
}
function getSpread(fid) {
    const pYears = getSelectedPeriodYears();
    const vals = pYears.map(y => districtById[fid].avg[y]).filter(v => v !== null && v !== undefined);
    return vals.length ? +(Math.max(...vals) - Math.min(...vals)).toFixed(1) : 0;
}
function getPeriodNorm(fid) {
    const pYears = getSelectedPeriodYears();
    const vals = pYears.map(y => districtById[fid].avg[y]).filter(v => v !== null && v !== undefined);
    return vals.length ? +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : null;
}
function getPeakScore(fid) {
    const pYears = getSelectedPeriodYears();
    let maxV = -1, maxY = null;
    pYears.forEach(y => {
        const v = districtById[fid].avg[y];
        if (v !== null && v !== undefined && v > maxV) { maxV = v; maxY = y; }
    });
    return maxY ? { val: maxV, year: maxY } : null;
}
function getTypology(fid) {
    const dA = getDynAvg(fid), dK = getDynKol(fid);
    if (Math.abs(dA) <= 5 && Math.abs(dK) <= 5) return { name: "Тип 4: Стабильность", color: "#fee08b" };
    if (dK > 0 && dA > 5) return { name: "Тип 1: Устойчивый рост", color: "#1a9850" };
    if (dK > 5 && dA < -3) return { name: "Тип 2: Рост уч. при сниж. балла", color: "#e67e22" };
    if (dK < 0 && dA > 5) return { name: "Тип 3: Сниж. уч. при росте балла", color: "#3498db" };
    if (dA < -5) return { name: "Зона снижения балла", color: "#d73027" };
    return { name: "Тип 4: Стабильность", color: "#fee08b" };
}

function getColorAvg(v) {
    if (v === null || v === undefined) return "#bdc3c7";
    return v > 85 ? "#1a9850" : v > 75 ? "#66bd63" : v > 65 ? "#a6d96a" : v > 55 ? "#fee08b" : v > 45 ? "#f46d43" : "#d73027";
}
function getColorKol(v) {
    if (v === null || v === undefined) return "#bdc3c7";
    return v > 50 ? "#4a0e4e" : v > 25 ? "#081d58" : v > 15 ? "#225ea8" : v > 8 ? "#41b6c4" : v > 3 ? "#7fcdbb" : "#ffffcc";
}
function getColorDynAvg(d) {
    return d > 15 ? "#1a9850" : d > 5 ? "#91cf60" : d >= -5 ? "#ffffbf" : d >= -15 ? "#fc8d59" : "#d73027";
}
function getColorDynKol(d) {
    return d > 20 ? "#1a9850" : d > 5 ? "#91cf60" : d >= 0 ? "#ffffbf" : d >= -5 ? "#fc8d59" : "#d73027";
}
function getColorStability(s) {
    return s < 7 ? "#2ecc71" : s <= 15 ? "#f1c40f" : "#e74c3c";
}

function getFeatureFillColor(fid, mode) {
    const d = districtById[fid];
    if (mode === "avg") return getColorAvg(d.avg[currentYear]);
    if (mode === "kol") return getColorKol(d.kol[currentYear]);
    if (mode === "dyn_avg") return getColorDynAvg(getDynAvg(fid));
    if (mode === "dyn_kol") return getColorDynKol(getDynKol(fid));
    if (mode === "typology") return getTypology(fid).color;
    if (mode === "stability") return getColorStability(getSpread(fid));
    return "#ccc";
}

function toggleLegendFilter(colorHex) {
    activeLegendBin = (activeLegendBin === colorHex) ? null : colorHex;
    renderMap(false);
}

const legend = L.control({ position: "bottomright" });
legend.onAdd = function () { return L.DomUtil.create("div", "legend"); };
legend.addTo(map);

function updateLegend(mode) {
    const div = legend.getContainer();
    if (!div) return;
    const y1 = Math.min(parseInt(yearFromSel.value), parseInt(yearToSel.value));
    const y2 = Math.max(parseInt(yearFromSel.value), parseInt(yearToSel.value));

    const row = (col, text) => `<div class="legend-row ${activeLegendBin === col ? 'active-filter' : ''}" onclick="toggleLegendFilter('${col}')"><i style="background:${col}"></i><span>${text}</span></div>`;

    let html = "";
    if (mode === "avg") {
        html = `<b>Средний балл ЕГЭ (${currentYear} г.)</b>` +
            row("#d73027", "менее 45") + row("#f46d43", "46 – 55") +
            row("#fee08b", "56 – 65") + row("#a6d96a", "66 – 75") +
            row("#66bd63", "76 – 85") + row("#1a9850", "более 85");
    } else if (mode === "kol") {
        html = `<b>Количество участников (${currentYear} г.)</b>` +
            row("#ffffcc", "1 – 3 чел.") + row("#7fcdbb", "4 – 8 чел.") +
            row("#41b6c4", "9 – 15 чел.") + row("#225ea8", "16 – 25 чел.") +
            row("#081d58", "26 – 50 чел.") + row("#4a0e4e", "> 50 (крупные центры)");
    } else if (mode === "dyn_avg") {
        html = `<b>Динамика балла (${y2} к ${y1} г.)</b>` +
            row("#d73027", "менее -15") + row("#fc8d59", "-15 .. -5") +
            row("#ffffbf", "-5 .. +5") + row("#91cf60", "+5 .. +15") +
            row("#1a9850", "более +15");
    } else if (mode === "dyn_kol") {
        html = `<b>Динамика уч. (${y2} к ${y1} г.)</b>` +
            row("#d73027", "менее -5") + row("#fc8d59", "-5 .. 0") +
            row("#ffffbf", "0 .. +5") + row("#91cf60", "+5 .. +20") +
            row("#1a9850", "более +20");
    } else if (mode === "typology") {
        html = `<b>Типология МО (${y1}–${y2} гг.)</b>` +
            row("#1a9850", "Тип 1: Устойчивый рост") +
            row("#e67e22", "Тип 2: Рост уч. при сниж. балла") +
            row("#3498db", "Тип 3: Сниж. уч. при росте балла") +
            row("#fee08b", "Тип 4: Стабильность");
    } else if (mode === "stability") {
        html = `<b>Размах колебаний (${y1}–${y2} гг.)</b>` +
            row("#2ecc71", "Стабильные (< 7 б.)") +
            row("#f1c40f", "Средние (7–15 б.)") +
            row("#e74c3c", "Нестабильные (> 15 б.)");
    }

    html += `<div class="legend-hint">💡 Кликните на интервал для фильтрации карты</div>`;

    if (document.getElementById("chk-circles").checked) {
        html += '<hr style="margin:6px 0; border:0; border-top:1px solid #e5e5ea;">' +
                '<b>Количество участников (чел.):</b><br>' +
                '<div style="display:flex; align-items:center; justify-content:space-between; margin-top:3px;">' +
                '<span><span class="circle-sample" style="width:16px;height:16px;">5</span> 1–10</span>' +
                '<span><span class="circle-sample" style="width:21px;height:21px;">24</span> 11–50</span>' +
                '<span><span class="circle-sample" style="width:26px;height:26px;">244</span> >50</span>' +
                '</div>';
    }
    div.innerHTML = html;
}

function renderMap(fitView = false) {
    if (geoLayer) map.removeLayer(geoLayer);
    badgeMarkers.forEach(m => map.removeLayer(m));
    labelMarkers.forEach(m => map.removeLayer(m));
    badgeMarkers = [];
    labelMarkers = [];
    layerByFidMap = {};

    const mode = document.getElementById("mode-select").value;
    const showCircles = document.getElementById("chk-circles").checked;
    const showLabels = document.getElementById("chk-labels").checked;
    const isolateMode = document.getElementById("chk-isolate").checked && selectedFid !== "all";

    const isYearly = (mode === "avg" || mode === "kol");
    document.getElementById("time-panel").style.display = isYearly ? "flex" : "none";

    updateMethodBanner(mode);
    updateLegend(mode);
    updateTopTables();

    const featuresToDraw = isolateMode
        ? allFeatures.filter(f => f.properties.fid == selectedFid)
        : allFeatures;

    geoLayer = L.geoJSON({ type: "FeatureCollection", features: featuresToDraw }, {
        style: function (feature) {
            const fid = feature.properties.fid;
            const fill = getFeatureFillColor(fid, mode);
            const isSel = (fid == selectedFid || fid == compareFid);
            const matchesFilter = !activeLegendBin || (fill.toLowerCase() === activeLegendBin.toLowerCase());

            return {
                fillColor: fill,
                weight: isSel ? 3 : (matchesFilter ? 1.2 : 0.6),
                color: fid == compareFid ? "#8e44ad" : (fid == selectedFid ? "#1d1d1f" : "#6e6e73"),
                fillOpacity: matchesFilter ? 0.86 : 0.14
            };
        },
        onEachFeature: function (feature, layer) {
            const fid = feature.properties.fid;
            layerByFidMap[fid] = layer;
            const d = districtById[fid];
            const avg = d.avg[currentYear] ?? "нет данных";
            const kol = d.kol[currentYear] ?? "нет данных";

            layer.bindTooltip(
                `<b>${d.name}</b><br>Ср. балл (${currentYear}): <b>${avg}</b> | Уч.: <b>${kol}</b>`,
                { sticky: true }
            );
            layer.on("click", () => selectDistrict(fid, true));

            const center = d.center ? L.latLng(d.center[0], d.center[1]) : layer.getBounds().getCenter();

            if (showCircles && d.kol[currentYear]) {
                const val = d.kol[currentYear];
                const size = val > 100 ? 34 : val > 30 ? 28 : val > 10 ? 23 : 18;
                const icon = L.divIcon({
                    className: "",
                    html: `<div class="kol-badge" style="width:${size}px;height:${size}px;">${val}</div>`,
                    iconSize: [size, size],
                    iconAnchor: [size / 2, size / 2]
                });
                const marker = L.marker(center, { icon: icon }).addTo(map);
                marker.bindTooltip(`<b>${d.name}</b>: ${val} уч.`);
                marker.on("click", () => selectDistrict(fid, true));
                badgeMarkers.push(marker);
            }

            if (showLabels) {
                const shortName = d.name.replace(" район", "").replace("г-к. ", "").replace("г. ", "");
                const lblIcon = L.divIcon({
                    className: "district-label",
                    html: `<div>${shortName}</div>`,
                    iconSize: [0, 0]
                });
                const lblMarker = L.marker(center, { icon: lblIcon, interactive: false }).addTo(map);
                labelMarkers.push(lblMarker);
            }
        }
    }).addTo(map);

    if (fitView && selectedFid !== "all" && layerByFidMap[selectedFid]) {
        map.fitBounds(layerByFidMap[selectedFid].getBounds(), { maxZoom: 9, padding: [40, 40] });
    } else if (fitView && selectedFid === "all" && geoLayer.getLayers().length > 0) {
        map.fitBounds(geoLayer.getBounds(), { maxZoom: 7 });
    }
}

const scoreChart = new Chart(document.getElementById("scoreChart"), {
    type: "line",
    data: { labels: [], datasets: [] },
    options: { plugins: { legend: { labels: { boxWidth: 10, font: { size: 10.5 } } } }, scales: { y: { min: 35, max: 95 } } }
});
const partChart = new Chart(document.getElementById("partChart"), {
    type: "bar",
    data: { labels: [], datasets: [] },
    options: { plugins: { legend: { labels: { boxWidth: 10, font: { size: 10.5 } } } } }
});
const devChart = new Chart(document.getElementById("devChart"), {
    type: "bar",
    data: { labels: [], datasets: [] },
    options: { plugins: { legend: { display: false } } }
});
const scatterChart = new Chart(document.getElementById("scatterChart"), {
    type: "scatter",
    data: { datasets: [] },
    options: {
        plugins: {
            legend: { labels: { boxWidth: 9, font: { size: 10 } } },
            tooltip: {
                callbacks: {
                    label: function(ctx) {
                        return `${ctx.raw.name}: уч. ${ctx.raw.x} чел., ср. балл ${ctx.raw.y}`;
                    }
                }
            }
        },
        scales: {
            x: { title: { display: true, text: "Количество участников (чел.)", font: { size: 10.5 } }, min: 0 },
            y: { title: { display: true, text: "Средний балл ЕГЭ", font: { size: 10.5 } }, min: 40, max: 90 }
        }
    }
});

function getRank(fid, year) {
    const val = districtById[fid].avg[year];
    if (val === null || val === undefined) return "—";
    const sorted = Object.values(districtById)
        .map(d => d.avg[year])
        .filter(v => v !== null && v !== undefined)
        .sort((a, b) => b - a);
    return (sorted.indexOf(val) + 1) + " место";
}

function updateTopTables() {
    const valid = Object.keys(districtById)
        .filter(k => districtById[k].avg[currentYear] !== null && districtById[k].avg[currentYear] !== undefined)
        .sort((a, b) => districtById[b].avg[currentYear] - districtById[a].avg[currentYear]);

    document.getElementById("top-leaders").innerHTML = valid.slice(0, 5).map((fid, i) =>
        `<div class="top-item" onclick="selectDistrict(${fid}, true)"><span>${i + 1}. ${districtById[fid].name.replace(" район", "")}</span><b>${districtById[fid].avg[currentYear]}</b></div>`
    ).join("");

    document.getElementById("top-outsiders").innerHTML = valid.slice(-5).reverse().map((fid, i) =>
        `<div class="top-item" onclick="selectDistrict(${fid}, true)"><span>${i + 1}. ${districtById[fid].name.replace(" район", "")}</span><b>${districtById[fid].avg[currentYear]}</b></div>`
    ).join("");
}

function updateScatterChart() {
    const hideKrasnodar = document.getElementById("chk-hide-krasnodar").checked;
    const groups = {
        t1: { label: "Устойчивый рост", color: "#1a9850", data: [] },
        t2: { label: "Рост уч. при сниж. балла", color: "#e67e22", data: [] },
        t3: { label: "Сниж. уч. при росте балла", color: "#3498db", data: [] },
        t4: { label: "Стабильные / Прочие", color: "#f59e0b", data: [] },
        sel: { label: "Выбранный МО", color: "#1d1d1f", data: [] }
    };

    Object.values(districtById).forEach(d => {
        const x = d.kol[currentYear];
        const y = d.avg[currentYear];
        if (!x || !y) return;
        if (hideKrasnodar && x > 80 && d.fid != selectedFid) return;

        const pt = { x, y, name: d.name };
        if (d.fid == selectedFid || d.fid == compareFid) {
            groups.sel.data.push(pt);
        } else {
            const tName = getTypology(d.fid).name;
            if (tName.includes("Тип 1")) groups.t1.data.push(pt);
            else if (tName.includes("Тип 2")) groups.t2.data.push(pt);
            else if (tName.includes("Тип 3")) groups.t3.data.push(pt);
            else groups.t4.data.push(pt);
        }
    });

    scatterChart.data.datasets = [
        ...(groups.sel.data.length ? [{ label: groups.sel.label, data: groups.sel.data, backgroundColor: "#ef4444", borderColor: "#1d1d1f", borderWidth: 2, pointRadius: 8 }] : []),
        { label: groups.t1.label, data: groups.t1.data, backgroundColor: groups.t1.color, pointRadius: 5.5 },
        { label: groups.t2.label, data: groups.t2.data, backgroundColor: groups.t2.color, pointRadius: 5.5 },
        { label: groups.t3.label, data: groups.t3.data, backgroundColor: groups.t3.color, pointRadius: 5.5 },
        { label: groups.t4.label, data: groups.t4.data, backgroundColor: groups.t4.color, pointRadius: 5.5 }
    ];
    scatterChart.update();
}

function selectDistrict(fid, zoomTo = false) {
    selectedFid = fid;
    distSelect.value = fid;
    const y1 = Math.min(parseInt(yearFromSel.value), parseInt(yearToSel.value));
    const y2 = Math.max(parseInt(yearFromSel.value), parseInt(yearToSel.value));
    const pYears = getSelectedPeriodYears();

    document.querySelectorAll(".cur-year").forEach(el => el.innerText = currentYear);
    updateDistrictBottomCard(fid);

    const corrVal = getPearsonCorr(fid);
    document.getElementById("corr-pill").innerText = corrVal !== null ? `Корреляция r: ${corrVal}` : "Корреляция r: —";
    document.getElementById("auto-insight-text").innerText = generateAutoInsight(fid);

    scoreChart.data.labels = years;
    partChart.data.labels = years;
    devChart.data.labels = years;

    if (fid === "all") {
        document.getElementById("isolate-bar").style.display = "none";
        document.getElementById("chk-isolate").checked = false;
        document.getElementById("region-name").innerText = "Весь Краснодарский край";
        document.getElementById("region-type").innerText = `Сводная статистика по 44 муниципальным образованиям`;
        document.getElementById("neighbors-pill").innerText = "Все 44 МО края";

        const kAvg = kraiAvgByYear[currentYear];
        const kKol = kraiKolByYear[currentYear];
        document.getElementById("val-avg").innerText = kAvg ?? "—";
        document.getElementById("sub-avg").innerText = "региональный уровень";
        document.getElementById("val-kol").innerText = kKol ? kKol + " чел." : "—";
        document.getElementById("sub-kol").innerText = "100% контингента края";

        const aboveCnt = Object.values(districtById).filter(d => d.avg[currentYear] !== null && d.avg[currentYear] >= kAvg).length;
        document.getElementById("rank-label").innerText = "МО выше среднего";
        document.getElementById("val-rank").innerText = aboveCnt + " из 44";
        document.getElementById("sub-rank").innerText = `${Math.round(aboveCnt / 44 * 100)}% территории`;

        const kraiVals = pYears.map(y => kraiAvgByYear[y]).filter(Boolean);
        const kNorm = (kraiVals.reduce((a, b) => a + b, 0) / kraiVals.length).toFixed(1);
        const kMax = Math.max(...kraiVals);
        const kMaxY = pYears.find(y => kraiAvgByYear[y] === kMax);
        const kDyn = +(kraiAvgByYear[y2] - kraiAvgByYear[y1]).toFixed(1);
        const kSpread = +(Math.max(...kraiVals) - Math.min(...kraiVals)).toFixed(1);

        document.getElementById("val-norm").innerText = kNorm + " б.";
        document.getElementById("sub-norm").innerText = `за ${y1}–${y2} гг.`;
        document.getElementById("val-peak").innerText = `${kMax} б.`;
        document.getElementById("sub-peak").innerText = `в ${kMaxY} году`;
        document.getElementById("val-dyn").innerText = (kDyn > 0 ? "+" : "") + kDyn + " б.";
        document.getElementById("sub-spread").innerText = `размах: ${kSpread} б.`;

        scoreChart.data.datasets = [{
            label: "Средний балл по краю",
            data: years.map(y => kraiAvgByYear[y]),
            borderColor: "#10b981", backgroundColor: "rgba(16,185,129,0.14)", fill: true, tension: 0.3, borderWidth: 2.5
        }];
        scoreChart.update();

        partChart.data.datasets = [{
            label: "Участников в крае (чел.)",
            data: years.map(y => kraiKolByYear[y]),
            backgroundColor: "#0071e3", borderRadius: 4
        }];
        partChart.update();

        devChart.data.datasets = [{
            label: "Изменение к пред. году",
            data: years.map((y, idx) => idx === 0 ? 0 : +(kraiAvgByYear[y] - kraiAvgByYear[years[idx - 1]]).toFixed(1)),
            backgroundColor: "#6366f1", borderRadius: 4
        }];
        devChart.update();

        updateScatterChart();
        renderMap(zoomTo);
        return;
    }

    document.getElementById("isolate-bar").style.display = "flex";
    const d = districtById[fid];
    document.getElementById("region-name").innerText = d.name;
    const typ = getTypology(fid);
    const spread = getSpread(fid);
    document.getElementById("region-type").innerText = `${typ.name} • Размах (${y1}–${y2}): ${spread} б.`;

    const curAvg = d.avg[currentYear];
    const curKol = d.kol[currentYear];
    const kAvg = kraiAvgByYear[currentYear];
    const diffKrai = (curAvg && kAvg) ? +(curAvg - kAvg).toFixed(1) : null;

    const nAvg = getNeighborsAvg(fid, currentYear);
    if (nAvg && curAvg) {
        const dN = +(curAvg - nAvg).toFixed(1);
        document.getElementById("neighbors-pill").innerText = `К соседям (${nAvg}): ${dN > 0 ? "+" : ""}${dN} б.`;
    } else {
        document.getElementById("neighbors-pill").innerText = "Соседи: —";
    }

    document.getElementById("val-avg").innerText = curAvg ?? "нет данных";
    document.getElementById("sub-avg").innerText = diffKrai !== null ? `${diffKrai > 0 ? "+" : ""}${diffKrai} б. к краю (${kAvg})` : `по краю: ${kAvg}`;
    document.getElementById("val-kol").innerText = curKol ? curKol + " чел." : "нет данных";
    document.getElementById("sub-kol").innerText = (curKol && kraiKolByYear[currentYear]) ? `${((curKol / kraiKolByYear[currentYear]) * 100).toFixed(1)}% от края` : "доля в крае";
    document.getElementById("rank-label").innerText = "Рейтинг в крае";
    document.getElementById("val-rank").innerText = getRank(fid, currentYear);
    document.getElementById("sub-rank").innerText = "по среднему баллу";

    const norm = getPeriodNorm(fid);
    const peak = getPeakScore(fid);
    const dynA = getDynAvg(fid);
    document.getElementById("val-norm").innerText = norm ? norm + " б." : "—";
    document.getElementById("sub-norm").innerText = `за ${y1}–${y2} гг.`;
    document.getElementById("val-peak").innerText = peak ? peak.val + " б." : "—";
    document.getElementById("sub-peak").innerText = peak ? `рекорд ${peak.year} года` : "максимум";
    document.getElementById("val-dyn").innerText = (dynA > 0 ? "+" : "") + dynA + " б.";
    document.getElementById("sub-spread").innerText = `размах: ${spread} б.`;

    const scoreDatasets = [
        { label: d.name, data: years.map(y => d.avg[y]), borderColor: "#10b981", backgroundColor: "rgba(16,185,129,0.12)", fill: true, tension: 0.3, borderWidth: 2.5 }
    ];
    const partDatasets = [
        { label: d.name, data: years.map(y => d.kol[y]), backgroundColor: "#3730a3", borderRadius: 4 }
    ];

    if (compareFid !== "none" && districtById[compareFid]) {
        const cd = districtById[compareFid];
        scoreDatasets.push({ label: cd.name, data: years.map(y => cd.avg[y]), borderColor: "#8b5cf6", backgroundColor: "transparent", borderWidth: 2.5, tension: 0.3 });
        partDatasets.push({ label: cd.name, data: years.map(y => cd.kol[y]), backgroundColor: "#a855f7", borderRadius: 4 });
    }

    scoreDatasets.push({
        label: "Средний по краю", data: years.map(y => kraiAvgByYear[y]), borderColor: "#86868b", borderDash: [5, 5], borderWidth: 1.8, pointRadius: 2, fill: false
    });

    scoreChart.data.datasets = scoreDatasets;
    scoreChart.update();

    partChart.data.datasets = partDatasets;
    partChart.update();

    const diffs = years.map(y => (d.avg[y] !== null && d.avg[y] !== undefined) ? +(d.avg[y] - kraiAvgByYear[y]).toFixed(1) : 0);
    devChart.data.datasets = [{
        label: "Отклонение от края (б.)",
        data: diffs,
        backgroundColor: diffs.map(v => v >= 0 ? "#10b981" : "#ef4444"),
        borderRadius: 4
    }];
    devChart.update();

    updateScatterChart();
    renderMap(zoomTo);
}

// ==========================================
// УМНЫЙ КОНСТРУКТОР ОТЧЕТОВ (PDF И EXCEL)
// ==========================================
let currentExportFormat = "pdf";

function openExportModal() {
    document.getElementById("exp-district").value = selectedFid;
    document.getElementById("exp-compare").value = compareFid;
    document.getElementById("export-modal").style.display = "flex";
}
function closeExportModal() {
    document.getElementById("export-modal").style.display = "none";
}
function selectFormat(fmt) {
    currentExportFormat = fmt;
    document.getElementById("fmt-pdf-card").classList.toggle("active", fmt === "pdf");
    document.getElementById("fmt-xlsx-card").classList.toggle("active", fmt === "xlsx");
    document.getElementById("exp-chk-charts-wrap").style.display = fmt === "pdf" ? "flex" : "none";
}

function generateCustomReport() {
    const targetFid = document.getElementById("exp-district").value;
    const compFid = document.getElementById("exp-compare").value;
    const incAvg = document.getElementById("exp-chk-avg").checked;
    const incKol = document.getElementById("exp-chk-kol").checked;
    const incKrai = document.getElementById("exp-chk-krai").checked;
    const incDyn = document.getElementById("exp-chk-dyn").checked;
    const incCharts = document.getElementById("exp-chk-charts").checked;
    const incAllMo = document.getElementById("exp-chk-allmo").checked;

    closeExportModal();

    if (currentExportFormat === "xlsx") {
        exportCustomExcel(targetFid, compFid, { incAvg, incKol, incKrai, incDyn, incAllMo });
    } else {
        exportCustomPDF(targetFid, compFid, { incAvg, incKol, incKrai, incDyn, incCharts, incAllMo });
    }
}

function exportCustomExcel(targetFid, compFid, opts) {
    const wb = XLSX.utils.book_new();
    const mainName = targetFid === "all" ? "Весь Краснодарский край" : districtById[targetFid].name;
    const compName = (compFid !== "none" && districtById[compFid]) ? districtById[compFid].name : null;

    const rowsMain = [];
    years.forEach(y => {
        const row = { "Год": y };
        if (opts.incAvg) {
            row[`Средний балл (${mainName})`] = targetFid === "all" ? kraiAvgByYear[y] : (districtById[targetFid].avg[y] ?? "—");
            if (compName) row[`Средний балл (${compName})`] = districtById[compFid].avg[y] ?? "—";
        }
        if (opts.incKrai && targetFid !== "all") {
            row["Средний балл по краю"] = kraiAvgByYear[y];
            const v = districtById[targetFid].avg[y];
            row["Отклонение от края (±)"] = v ? +(v - kraiAvgByYear[y]).toFixed(1) : "—";
            row["Средний балл соседних МО"] = getNeighborsAvg(targetFid, y) ?? "—";
        }
        if (opts.incKol) {
            row[`Участников (${mainName}), чел.`] = targetFid === "all" ? kraiKolByYear[y] : (districtById[targetFid].kol[y] ?? "—");
            if (compName) row[`Участников (${compName}), чел.`] = districtById[compFid].kol[y] ?? "—";
        }
        rowsMain.push(row);
    });
    const wsMain = XLSX.utils.json_to_sheet(rowsMain);
    XLSX.utils.book_append_sheet(wb, wsMain, "Динамика по годам");

    if (opts.incDyn || opts.incAllMo || targetFid === "all") {
        const rowsMo = Object.values(districtById)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(d => {
                const r = { "Муниципальное образование": d.name };
                if (opts.incAvg) {
                    years.forEach(y => { r[`Балл ${y}`] = d.avg[y] ?? "—"; });
                }
                if (opts.incKol) {
                    r[`Участников (${currentYear})`] = d.kol[currentYear] ?? "—";
                }
                if (opts.incDyn) {
                    r["Среднее за период"] = getPeriodNorm(d.fid) ?? "—";
                    r["Динамика балла"] = getDynAvg(d.fid);
                    r["Размах колебаний"] = getSpread(d.fid);
                    r["Корреляция Пирсона (r)"] = getPearsonCorr(d.fid) ?? "—";
                    r["Типология МО"] = getTypology(d.fid).name;
                }
                return r;
            });
        const wsMo = XLSX.utils.json_to_sheet(rowsMo);
        XLSX.utils.book_append_sheet(wb, wsMo, "Сводная по 44 МО");
    }

    XLSX.writeFile(wb, `Otchet_EGE_${targetFid === "all" ? "Krasnodar_Krai" : districtById[targetFid].short_name}.xlsx`);
}

function exportCustomPDF(targetFid, compFid, opts) {
    if (targetFid != selectedFid || compFid != compareFid) {
        compareFid = compFid;
        selectDistrict(targetFid === "all" ? "all" : parseInt(targetFid), false);
    }

    const mainName = targetFid === "all" ? "Весь Краснодарский край" : districtById[targetFid].name;
    const compName = (compFid !== "none" && districtById[compFid]) ? districtById[compFid].name : null;
    const y1 = Math.min(parseInt(yearFromSel.value), parseInt(yearToSel.value));
    const y2 = Math.max(parseInt(yearFromSel.value), parseInt(yearToSel.value));

    const imgScore = document.getElementById("scoreChart").toDataURL("image/png", 1.0);
    const imgPart = document.getElementById("partChart").toDataURL("image/png", 1.0);
    const imgDev = document.getElementById("devChart").toDataURL("image/png", 1.0);

    let dynBlock = "";
    if (opts.incDyn) {
        const insightText = generateAutoInsight(targetFid);
        dynBlock = `
            <div style="background:#f0f7ff; border-left:4px solid #0071e3; padding:12px 16px; border-radius:6px; font-size:12.5px; margin-bottom:16px; line-height:1.45;">
                <b>📊 Аналитическая записка:</b> ${insightText}
            </div>`;
    }

    let tableHeaders = `<th>Год</th>`;
    if (opts.incAvg) {
        tableHeaders += `<th>Ср. балл (${mainName})</th>`;
        if (compName) tableHeaders += `<th>Ср. балл (${compName})</th>`;
    }
    if (opts.incKrai && targetFid !== "all") tableHeaders += `<th>Средний по краю</th><th>Отклонение (±)</th><th>Ср. по соседям</th>`;
    if (opts.incKol) {
        tableHeaders += `<th>Участников (${mainName})</th>`;
        if (compName) tableHeaders += `<th>Участников (${compName})</th>`;
    }

    let tableRows = "";
    years.forEach(y => {
        tableRows += `<tr><td><b>${y}</b></td>`;
        if (opts.incAvg) {
            const v = targetFid === "all" ? kraiAvgByYear[y] : (districtById[targetFid].avg[y] ?? "—");
            tableRows += `<td>${v}</td>`;
            if (compName) tableRows += `<td>${districtById[compFid].avg[y] ?? "—"}</td>`;
        }
        if (opts.incKrai && targetFid !== "all") {
            const v = districtById[targetFid].avg[y];
            const diff = v ? +(v - kraiAvgByYear[y]).toFixed(1) : "—";
            tableRows += `<td>${kraiAvgByYear[y]}</td><td>${diff > 0 ? "+" + diff : diff}</td><td>${getNeighborsAvg(targetFid, y) ?? "—"}</td>`;
        }
        if (opts.incKol) {
            const k = targetFid === "all" ? kraiKolByYear[y] : (districtById[targetFid].kol[y] ?? "—");
            tableRows += `<td>${k}</td>`;
            if (compName) tableRows += `<td>${districtById[compFid].kol[y] ?? "—"}</td>`;
        }
        tableRows += `</tr>`;
    });

    let allMoHtml = "";
    if (opts.incAllMo) {
        const sortedMo = Object.values(districtById).sort((a, b) => a.name.localeCompare(b.name));
        allMoHtml = `<h3 style="margin-top:24px;">Сводная ведомость по муниципальным образованиям (${currentYear} г.)</h3>
        <table><thead><tr><th>Муниципальное образование</th><th>Участников (${currentYear})</th><th>Ср. балл (${currentYear})</th><th>Динамика (${y1}–${y2})</th><th>Размах</th><th>Корр. r</th><th>Типология</th></tr></thead><tbody>` +
        sortedMo.map(d => `<tr>
            <td style="text-align:left;">${d.name}</td>
            <td>${d.kol[currentYear] ?? "—"}</td>
            <td><b>${d.avg[currentYear] ?? "—"}</b></td>
            <td>${getDynAvg(d.fid) > 0 ? "+" : ""}${getDynAvg(d.fid)}</td>
            <td>${getSpread(d.fid)}</td>
            <td>${getPearsonCorr(d.fid) ?? "—"}</td>
            <td style="text-align:left;">${getTypology(d.fid).name}</td>
        </tr>`).join("") + `</tbody></table>`;
    }

    const chartsHtml = opts.incCharts ? `
        <h3>Графическая аналитика</h3>
        <div class="charts-grid">
            <div class="chart-card"><div class="c-cap">Динамика среднего балла</div><img src="${imgScore}"></div>
            <div class="chart-card"><div class="c-cap">Численность участников (чел.)</div><img src="${imgPart}"></div>
        </div>
        ${targetFid !== "all" ? `<div class="chart-card" style="margin-top:12px;"><div class="c-cap">Отклонение среднего балла от краевого уровня (± б.)</div><img src="${imgDev}" style="max-height:170px;"></div>` : ""}
    ` : "";

    const win = window.open("", "_blank");
    win.document.write(`<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8">
        <title>Аналитический отчет ЕГЭ — ${mainName}</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
        <style>
            body { font-family: 'Inter', sans-serif; color: #1d1d1f; padding: 28px 36px; max-width: 920px; margin: 0 auto; }
            .doc-header { border-bottom: 2px solid #1d1d1f; padding-bottom: 12px; margin-bottom: 18px; display:flex; justify-content:space-between; align-items:flex-end; }
            .doc-header h1 { margin: 0; font-size: 20px; }
            .doc-sub { font-size: 12px; color: #6e6e73; margin-top: 4px; }
            h3 { font-size: 14px; margin: 16px 0 8px 0; color: #1d1d1f; }
            table { width: 100%; border-collapse: collapse; font-size: 11.5px; margin-bottom: 16px; }
            th, td { border: 1px solid #d2d2d7; padding: 6px 8px; text-align: center; }
            th { background: #f5f5f7; font-weight: 700; }
            .charts-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 14px; }
            .chart-card { border: 1px solid #e5e5ea; border-radius: 10px; padding: 10px; text-align: center; }
            .c-cap { font-size: 11.5px; font-weight: 600; margin-bottom: 6px; color: #515154; }
            img { max-width: 100%; height: auto; }
            @media print { body { padding: 0; } }
        </style>
    </head><body>
        <div class="doc-header">
            <div>
                <h1>Аналитическая справка: Результаты ЕГЭ по географии</h1>
                <div class="doc-sub">Объект: <b>${mainName}</b> ${compName ? ` (в сравнении с: ${compName})` : ""}</div>
            </div>
            <div style="font-size:11px; color:#6e6e73; text-align:right;">Краснодарский край<br>Дата формирования: ${new Date().toLocaleDateString("ru-RU")}</div>
        </div>
        ${dynBlock}
        ${chartsHtml}
        <h3>Статистическая ведомость по годам</h3>
        <table><thead><tr>${tableHeaders}</tr></thead><tbody>${tableRows}</tbody></table>
        ${allMoHtml}
        <script>window.onload = () => { setTimeout(() => window.print(), 350); };<\/script>
    </body></html>`);
    win.document.close();
}

document.getElementById("mode-select").addEventListener("change", () => {
    activeLegendBin = null;
    renderMap(false);
});
document.getElementById("chk-circles").addEventListener("change", () => renderMap(false));
document.getElementById("chk-labels").addEventListener("change", () => renderMap(false));
document.getElementById("chk-isolate").addEventListener("change", () => renderMap(true));
yearFromSel.addEventListener("change", () => selectDistrict(selectedFid, false));
yearToSel.addEventListener("change", () => selectDistrict(selectedFid, false));

yearSelect.addEventListener("change", (e) => {
    currentYear = parseInt(e.target.value);
    selectDistrict(selectedFid, false);
});

distSelect.addEventListener("change", (e) => {
    const val = e.target.value === "all" ? "all" : parseInt(e.target.value);
    selectDistrict(val, true);
});
compSelect.addEventListener("change", (e) => {
    compareFid = e.target.value;
    selectDistrict(selectedFid, false);
});

let timer = null;
const playBtn = document.getElementById("play-btn");
playBtn.addEventListener("click", () => {
    if (timer) { clearInterval(timer); timer = null; playBtn.innerText = "▶ Пуск"; }
    else {
        playBtn.innerText = "⏸ Пауза";
        timer = setInterval(() => {
            let idx = years.indexOf(currentYear);
            let nextYear = (idx >= 0 && idx < years.length - 1) ? years[idx + 1] : years[0];
            currentYear = nextYear;
            yearSelect.value = currentYear;
            selectDistrict(selectedFid, false);
        }, 1200);
    }
});

loadDataFromBackend();
