const API_BASE = ""; // Работает автоматически с тем же сервером FastAPI

let allFeatures = [];
let districtById = {};
let years = [];
let kraiAvgByYear = {};
let kraiKolByYear = {};

let currentYear = 2025;
let selectedFid = "all";
let compareFid = "none";

// Инициализация карты БЕЗ флага и префикса Leaflet
const map = L.map("map", { attributionControl: false }).setView([45.15, 39.1], 7);

const osm = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    referrerPolicy: "strict-origin-when-cross-origin"
}).addTo(map);

const esriLight = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}");

L.control.layers(
    { "Карта OpenStreetMap": osm, "Светлая подложка (Esri)": esriLight },
    null,
    { position: "topright" }
).addTo(map);

const distSelect = document.getElementById("district-select");
const compSelect = document.getElementById("compare-select");
const yearFromSel = document.getElementById("year-from");
const yearToSel = document.getElementById("year-to");
const slider = document.getElementById("year-slider");

let geoLayer = null;
let layerByFid = {};
let badgeMarkers = [];
let labelMarkers = [];

// Загрузка данных с Бэкенда (из PostgreSQL)
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

        // Настройка ползунка и списков годов
        slider.min = years[0];
        slider.max = years[years.length - 1];
        currentYear = years[years.length - 1];
        slider.value = currentYear;
        document.getElementById("year-label").innerText = currentYear;

        yearFromSel.innerHTML = "";
        yearToSel.innerHTML = "";
        years.forEach(y => {
            yearFromSel.add(new Option(y, y));
            yearToSel.add(new Option(y, y));
        });
        yearFromSel.value = years[0];
        yearToSel.value = years[years.length - 1];

        // Заполняем выпадающие списки районов
        distSelect.innerHTML = '<option value="all">📊 ВЕСЬ КРАСНОДАРСКИЙ КРАЙ</option>';
        compSelect.innerHTML = '<option value="none">— нет —</option>';
        [...allFeatures]
            .sort((a, b) => a.properties.name.localeCompare(b.properties.name))
            .forEach(f => {
                const p = f.properties;
                distSelect.add(new Option(p.name, p.fid));
                compSelect.add(new Option(p.name, p.fid));
            });

        document.getElementById("db-status").innerText = `● PostgreSQL: ${allFeatures.length} МО (${years[0]}–${years[years.length - 1]})`;
        selectDistrict("all", true);
    } catch (err) {
        console.error(err);
        document.getElementById("db-status").innerText = "✖ Ошибка связи с сервером";
        document.getElementById("db-status").style.background = "#fadbd8";
        document.getElementById("db-status").style.color = "#922b21";
    }
}

// Расчет аналитических показателей
function findNearestValid(obj, targetY, dir) {
    if (obj[targetY] !== null && obj[targetY] !== undefined) return obj[targetY];
    const sortedY = dir > 0 ? [...years] : [...years].reverse();
    for (let y of sortedY) {
        if (obj[y] !== null && obj[y] !== undefined) return obj[y];
    }
    return null;
}
function getDynAvg(fid) {
    const y1 = parseInt(yearFromSel.value), y2 = parseInt(yearToSel.value);
    const d = districtById[fid];
    const v1 = d.avg[y1] ?? findNearestValid(d.avg, y1, 1);
    const v2 = d.avg[y2] ?? findNearestValid(d.avg, y2, -1);
    return (v1 !== null && v2 !== null) ? +(v2 - v1).toFixed(1) : 0;
}
function getDynKol(fid) {
    const y1 = parseInt(yearFromSel.value), y2 = parseInt(yearToSel.value);
    const d = districtById[fid];
    const v1 = d.kol[y1] ?? findNearestValid(d.kol, y1, 1);
    const v2 = d.kol[y2] ?? findNearestValid(d.kol, y2, -1);
    return (v1 !== null && v2 !== null) ? (v2 - v1) : 0;
}
function getSpread(fid) {
    const y1 = Math.min(parseInt(yearFromSel.value), parseInt(yearToSel.value));
    const y2 = Math.max(parseInt(yearFromSel.value), parseInt(yearToSel.value));
    const vals = years.filter(y => y >= y1 && y <= y2).map(y => districtById[fid].avg[y]).filter(v => v !== null && v !== undefined);
    return vals.length ? +(Math.max(...vals) - Math.min(...vals)).toFixed(1) : 0;
}
function getTypology(fid) {
    const dA = getDynAvg(fid), dK = getDynKol(fid);
    if (Math.abs(dA) <= 5 && Math.abs(dK) <= 5) return { name: "Тип 4: Стабильность показателей", color: "#fee08b" };
    if (dK > 0 && dA > 5) return { name: "Тип 1: Устойчивый рост (балл ↑, уч. ↑)", color: "#1a9850" };
    if (dK > 5 && dA < -3) return { name: "Тип 2: Рост популярности при снижении балла", color: "#e67e22" };
    if (dK < 0 && dA > 5) return { name: "Тип 3: Снижение числа участников при росте балла", color: "#3498db" };
    if (dA < -5) return { name: "Зона снижения среднего балла", color: "#d73027" };
    return { name: "Тип 4: Умеренные колебания / стабильность", color: "#fee08b" };
}

// Цветовые шкалы
function getColorAvg(v) {
    if (v === null || v === undefined) return "#bdc3c7";
    return v > 85 ? "#1a9850" : v > 75 ? "#66bd63" : v > 65 ? "#a6d96a" : v > 55 ? "#fee08b" : v > 45 ? "#f46d43" : "#d73027";
}
function getColorKol(v) {
    if (v === null || v === undefined) return "#bdc3c7";
    return v > 25 ? "#081d58" : v > 15 ? "#225ea8" : v > 10 ? "#41b6c4" : v > 5 ? "#7fcdbb" : "#ffffcc";
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

// Легенда
const legend = L.control({ position: "bottomright" });
legend.onAdd = function () { return L.DomUtil.create("div", "legend"); };
legend.addTo(map);

function updateLegend(mode) {
    const div = legend.getContainer();
    if (!div) return;
    const y1 = yearFromSel.value, y2 = yearToSel.value;
    let html = "";
    if (mode === "avg") {
        html = `<b>Средний балл ЕГЭ (${currentYear} г.)</b><br>` +
            '<i style="background:#d73027"></i> менее 45<br><i style="background:#f46d43"></i> 46 – 55<br>' +
            '<i style="background:#fee08b"></i> 56 – 65<br><i style="background:#a6d96a"></i> 66 – 75<br>' +
            '<i style="background:#66bd63"></i> 76 – 85<br><i style="background:#1a9850"></i> более 85';
    } else if (mode === "kol") {
        html = `<b>Число участников (${currentYear} г.)</b><br>` +
            '<i style="background:#ffffcc"></i> 1 – 5<br><i style="background:#7fcdbb"></i> 6 – 10<br>' +
            '<i style="background:#41b6c4"></i> 11 – 15<br><i style="background:#225ea8"></i> 16 – 25<br>' +
            '<i style="background:#081d58"></i> более 25';
    } else if (mode === "dyn_avg") {
        html = `<b>Динамика балла (${y2} к ${y1} г.)</b><br>` +
            '<i style="background:#d73027"></i> менее -15<br><i style="background:#fc8d59"></i> -15 .. -5<br>' +
            '<i style="background:#ffffbf"></i> -5 .. +5<br><i style="background:#91cf60"></i> +5 .. +15<br>' +
            '<i style="background:#1a9850"></i> более +15';
    } else if (mode === "dyn_kol") {
        html = `<b>Динамика уч. (${y2} к ${y1} г.)</b><br>` +
            '<i style="background:#d73027"></i> менее -5<br><i style="background:#fc8d59"></i> -5 .. 0<br>' +
            '<i style="background:#ffffbf"></i> 0 .. +5<br><i style="background:#91cf60"></i> +5 .. +20<br>' +
            '<i style="background:#1a9850"></i> более +20';
    } else if (mode === "typology") {
        html = `<b>Типология МО (${y1}–${y2} гг.)</b><br>` +
            '<i style="background:#1a9850"></i> Устойчивый рост<br>' +
            '<i style="background:#e67e22"></i> Рост уч. при сниж. балла<br>' +
            '<i style="background:#3498db"></i> Снижение уч. при росте балла<br>' +
            '<i style="background:#fee08b"></i> Стабильность показателей<br>' +
            '<i style="background:#d73027"></i> Снижение среднего балла';
    } else if (mode === "stability") {
        html = `<b>Размах колебаний (${y1}–${y2} гг.)</b><br>` +
            '<i style="background:#2ecc71"></i> Стабильные (< 7 б.)<br>' +
            '<i style="background:#f1c40f"></i> Средние (7–15 б.)<br>' +
            '<i style="background:#e74c3c"></i> Нестабильные (> 15 б.)';
    }
    if (document.getElementById("chk-circles").checked) {
        html += '<hr style="margin:5px 0; border:0; border-top:1px solid #ddd;">' +
                '<b>Участники (значки):</b><br>' +
                '<span class="circle-sample" style="width:17px;height:17px;">8</span> 1–15 ' +
                '<span class="circle-sample" style="width:22px;height:22px;">36</span> 16–50 ' +
                '<span class="circle-sample" style="width:28px;height:28px;">244</span> >100';
    }
    div.innerHTML = html;
}

// Отрисовка карты (с поддержкой изоляции одного выбранного района)
function renderMap(fitView = false) {
    if (geoLayer) map.removeLayer(geoLayer);
    badgeMarkers.forEach(m => map.removeLayer(m));
    labelMarkers.forEach(m => map.removeLayer(m));
    badgeMarkers = [];
    labelMarkers = [];
    layerByFid = {};

    const mode = document.getElementById("mode-select").value;
    const showCircles = document.getElementById("chk-circles").checked;
    const showLabels = document.getElementById("chk-labels").checked;
    const isolateMode = document.getElementById("chk-isolate").checked && selectedFid !== "all";

    const isYearly = (mode === "avg" || mode === "kol");
    document.getElementById("time-panel").style.display = isYearly ? "flex" : "none";
    document.getElementById("period-box").style.display = isYearly ? "none" : "inline-flex";

    updateLegend(mode);
    updateTopTables();

    // Фильтруем полигоны, если включен режим "Оставить только выбранный район"
    const featuresToDraw = isolateMode
        ? allFeatures.filter(f => f.properties.fid == selectedFid)
        : allFeatures;

    const y1 = yearFromSel.value, y2 = yearToSel.value;

    geoLayer = L.geoJSON({ type: "FeatureCollection", features: featuresToDraw }, {
        style: function (feature) {
            const fid = feature.properties.fid;
            const d = districtById[fid];
            let fill = "#ccc";
            if (mode === "avg") fill = getColorAvg(d.avg[currentYear]);
            else if (mode === "kol") fill = getColorKol(d.kol[currentYear]);
            else if (mode === "dyn_avg") fill = getColorDynAvg(getDynAvg(fid));
            else if (mode === "dyn_kol") fill = getColorDynKol(getDynKol(fid));
            else if (mode === "typology") fill = getTypology(fid).color;
            else if (mode === "stability") fill = getColorStability(getSpread(fid));

            const isSel = (fid == selectedFid || fid == compareFid);
            return {
                fillColor: fill,
                weight: isSel ? 3 : 1.2,
                color: fid == compareFid ? "#8e44ad" : (fid == selectedFid ? "#111" : "#333"),
                fillOpacity: 0.82
            };
        },
        onEachFeature: function (feature, layer) {
            const fid = feature.properties.fid;
            layerByFid[fid] = layer;
            const d = districtById[fid];
            const avg = d.avg[currentYear] ?? "нет данных";
            const kol = d.kol[currentYear] ?? "нет данных";
            const dAvg = getDynAvg(fid);
            const spread = getSpread(fid);
            const typ = getTypology(fid).name;

            layer.bindTooltip(
                `<b>${d.name}</b><br>` +
                `Средний балл (${currentYear}): <b>${avg}</b> | Участников: <b>${kol}</b><br>` +
                `Динамика (${y1}→${y2}): <b>${dAvg > 0 ? "+" + dAvg : dAvg} б.</b> | Размах: <b>${spread} б.</b><br>` +
                `<i>${typ}</i>`,
                { sticky: true }
            );
            layer.on("click", () => selectDistrict(fid, false));

            const center = d.center ? L.latLng(d.center[0], d.center[1]) : layer.getBounds().getCenter();

            if (showCircles && d.kol[currentYear]) {
                const val = d.kol[currentYear];
                const size = val > 100 ? 33 : val > 25 ? 26 : val > 10 ? 22 : 18;
                const icon = L.divIcon({
                    className: "",
                    html: `<div class="kol-badge" style="width:${size}px;height:${size}px;">${val}</div>`,
                    iconSize: [size, size],
                    iconAnchor: [size / 2, size / 2]
                });
                const marker = L.marker(center, { icon: icon }).addTo(map);
                marker.bindTooltip(`<b>${d.name}</b>: ${val} уч. (ср. балл: ${avg})`);
                marker.on("click", () => selectDistrict(fid, false));
                badgeMarkers.push(marker);
            }

            if (showLabels) {
                const shortName = d.name.replace(" район", "").replace("г-к. ", "").replace("г. ", "");
                const offsetY = (showCircles && d.kol[currentYear]) ? -16 : 0;
                const lblIcon = L.divIcon({
                    className: "district-label",
                    html: `<div style="transform: translate(-50%, ${offsetY}px);">${shortName}</div>`,
                    iconSize: [0, 0]
                });
                const lblMarker = L.marker(center, { icon: lblIcon, interactive: false }).addTo(map);
                labelMarkers.push(lblMarker);
            }
        }
    }).addTo(map);

    if (fitView && geoLayer.getLayers().length > 0) {
        map.fitBounds(geoLayer.getBounds(), { maxZoom: isolateMode ? 10 : 8 });
    }
}

// Графики
const scoreChart = new Chart(document.getElementById("scoreChart"), {
    type: "line",
    data: { labels: [], datasets: [] },
    options: { plugins: { legend: { labels: { boxWidth: 12, font: { size: 11 } } } }, scales: { y: { min: 35, max: 95 } } }
});
const partChart = new Chart(document.getElementById("partChart"), {
    type: "bar",
    data: { labels: [], datasets: [] },
    options: { plugins: { legend: { labels: { boxWidth: 12, font: { size: 11 } } } } }
});

function getRank(fid, year) {
    const val = districtById[fid].avg[year];
    if (val === null || val === undefined) return "—";
    const sorted = Object.values(districtById)
        .map(d => d.avg[year])
        .filter(v => v !== null && v !== undefined)
        .sort((a, b) => b - a);
    return (sorted.indexOf(val) + 1) + " из " + sorted.length;
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

function selectDistrict(fid, zoomTo = false) {
    selectedFid = fid;
    distSelect.value = fid;
    document.querySelectorAll(".cur-year").forEach(el => el.innerText = currentYear);

    scoreChart.data.labels = years;
    partChart.data.labels = years;

    if (fid === "all") {
        document.getElementById("isolate-bar").style.display = "none";
        document.getElementById("chk-isolate").checked = false;
        document.getElementById("region-name").innerText = "📊 Весь Краснодарский край";
        document.getElementById("region-type").innerText = `Сводка по всем 44 муниципалитетам (${years[0]}–${years[years.length - 1]} гг.)`;
        document.getElementById("region-type").style.background = "#eaf2f8";

        document.getElementById("val-avg").innerText = kraiAvgByYear[currentYear] ?? "—";
        document.getElementById("val-kol").innerText = kraiKolByYear[currentYear] ? kraiKolByYear[currentYear] + " чел." : "—";

        const aboveCnt = Object.values(districtById).filter(d => d.avg[currentYear] !== null && d.avg[currentYear] >= kraiAvgByYear[currentYear]).length;
        document.getElementById("rank-label").innerText = "МО выше ср. балла";
        document.getElementById("val-rank").innerText = aboveCnt + " из 44";

        scoreChart.data.datasets = [{
            label: "Средний балл по Краснодарскому краю",
            data: years.map(y => kraiAvgByYear[y]),
            borderColor: "#27ae60", backgroundColor: "rgba(39,174,96,0.18)", fill: true, tension: 0.3, borderWidth: 3
        }];
        scoreChart.update();

        partChart.data.datasets = [{
            label: "Всего участников в крае (чел.)",
            data: years.map(y => kraiKolByYear[y]),
            backgroundColor: "#2980b9"
        }];
        partChart.update();

        renderMap(zoomTo);
        return;
    }

    document.getElementById("isolate-bar").style.display = "flex";
    const d = districtById[fid];
    const y1 = yearFromSel.value, y2 = yearToSel.value;
    document.getElementById("region-name").innerText = d.name;
    const typ = getTypology(fid);
    const spread = getSpread(fid);
    document.getElementById("region-type").innerText = `${typ.name} (${y1}–${y2}) | Размах: ${spread} б.`;
    document.getElementById("region-type").style.background = typ.color + "44";

    document.getElementById("val-avg").innerText = d.avg[currentYear] ?? "нет данных";
    document.getElementById("val-kol").innerText = d.kol[currentYear] ? d.kol[currentYear] + " чел." : "нет данных";
    document.getElementById("rank-label").innerText = "Рейтинг в крае";
    document.getElementById("val-rank").innerText = getRank(fid, currentYear);

    const scoreDatasets = [
        { label: d.name, data: years.map(y => d.avg[y]), borderColor: "#27ae60", backgroundColor: "rgba(39,174,96,0.12)", fill: true, tension: 0.3, borderWidth: 2.5 }
    ];
    const partDatasets = [
        { label: d.name + " (уч.)", data: years.map(y => d.kol[y]), backgroundColor: "#30336b" }
    ];

    if (compareFid !== "none" && districtById[compareFid]) {
        const cd = districtById[compareFid];
        scoreDatasets.push({ label: cd.name, data: years.map(y => cd.avg[y]), borderColor: "#8e44ad", backgroundColor: "transparent", borderWidth: 2.5, tension: 0.3 });
        partDatasets.push({ label: cd.name + " (уч.)", data: years.map(y => cd.kol[y]), backgroundColor: "#9b59b6" });
    }

    scoreDatasets.push({
        label: "Средний по краю", data: years.map(y => kraiAvgByYear[y]), borderColor: "#7f8c8d", borderDash: [5, 5], borderWidth: 1.8, pointRadius: 2, fill: false
    });

    scoreChart.data.datasets = scoreDatasets;
    scoreChart.update();

    partChart.data.datasets = partDatasets;
    partChart.update();

    renderMap(zoomTo);
}

// Выгрузка отчета Excel напрямую с бэкенда
function downloadExcelReport() {
    const url = selectedFid === "all"
        ? `${API_BASE}/api/report/excel`
        : `${API_BASE}/api/report/excel?fid=${selectedFid}`;
    window.location.href = url;
}

// Формирование красивого табличного PDF-отчета для печати
function printPDFReport() {
    let html = `<h4>Аналитическая ведомость результатов ЕГЭ по географии (${years[0]}–${years[years.length - 1]} гг.)</h4>`;
    html += `<table><thead><tr><th>Год</th><th>Участников (чел.)</th><th>Средний балл</th><th>Среднекраевой балл</th></tr></thead><tbody>`;

    years.forEach(y => {
        const kol = selectedFid === "all" ? kraiKolByYear[y] : (districtById[selectedFid].kol[y] ?? "—");
        const avg = selectedFid === "all" ? kraiAvgByYear[y] : (districtById[selectedFid].avg[y] ?? "—");
        const kAvg = kraiAvgByYear[y] ?? "—";
        html += `<tr><td><b>${y}</b></td><td>${kol}</td><td>${avg}</td><td>${kAvg}</td></tr>`;
    });
    html += `</tbody></table>`;
    document.getElementById("print-report-table").innerHTML = html;
    window.print();
}

// Загрузка нового файла Excel в PostgreSQL
document.getElementById("excel-upload").addEventListener("change", async function (e) {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);

    document.getElementById("db-status").innerText = "⏳ Загрузка в PostgreSQL...";
    const res = await fetch(`${API_BASE}/api/upload-excel`, { method: "POST", body: formData });
    if (res.ok) {
        const info = await res.json();
        alert(`✔ База данных PostgreSQL успешно обновлена! Загружены годы: ${info.years_loaded.join(", ")}`);
        await loadDataFromBackend();
    } else {
        alert("Ошибка при загрузке файла Excel. Проверьте названия столбцов (kol_ГОД, Avg_ГОД).");
    }
});

// Обработчики кнопок
document.getElementById("mode-select").addEventListener("change", () => selectDistrict(selectedFid, false));
document.getElementById("chk-circles").addEventListener("change", () => renderMap(false));
document.getElementById("chk-labels").addEventListener("change", () => renderMap(false));
document.getElementById("chk-isolate").addEventListener("change", () => renderMap(true));
yearFromSel.addEventListener("change", () => selectDistrict(selectedFid, false));
yearToSel.addEventListener("change", () => selectDistrict(selectedFid, false));

distSelect.addEventListener("change", (e) => {
    const val = e.target.value === "all" ? "all" : parseInt(e.target.value);
    selectDistrict(val, true);
});
compSelect.addEventListener("change", (e) => {
    compareFid = e.target.value;
    selectDistrict(selectedFid, false);
});

slider.addEventListener("input", (e) => {
    currentYear = parseInt(e.target.value);
    document.getElementById("year-label").innerText = currentYear;
    selectDistrict(selectedFid, false);
});

let timer = null;
const playBtn = document.getElementById("play-btn");
playBtn.addEventListener("click", () => {
    if (timer) { clearInterval(timer); timer = null; playBtn.innerText = "▶ Пуск"; }
    else {
        playBtn.innerText = "⏸ Пауза";
        timer = setInterval(() => {
            let idx = years.indexOf(parseInt(slider.value));
            let nextYear = (idx >= 0 && idx < years.length - 1) ? years[idx + 1] : years[0];
            slider.value = nextYear;
            slider.dispatchEvent(new Event("input"));
        }, 1200);
    }
});

loadDataFromBackend();