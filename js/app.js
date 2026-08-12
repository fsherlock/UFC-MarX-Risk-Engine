       const buildBtn = document.getElementById("buildBtn");
      const calcBtn = document.getElementById("calcBtn");
      const resetBtn = document.getElementById("resetBtn");
      const exportBtn = document.getElementById("exportBtn");
      const fightCountEl = document.getElementById("fightCount");
      const bankrollEl = document.getElementById("bankroll");
      const fightsContainer = document.getElementById("fightsContainer");
      const resultsContainer = document.getElementById("resultsContainer");
      const riskSummary = document.getElementById("riskSummary");
      const fightCountError = document.getElementById("fightCountError");
      const bankrollError = document.getElementById("bankrollError");
      const loadingMsg = document.getElementById("loadingMsg");
      const calcError = document.getElementById("calcError");
      const fighterCache = new Map();
      const upcomingSelected = new Map(); // Map<string, object> where key is eventIdx:fightIdx
      const strategyAllocations = { Kelly: 100, "Equal Stake": 100, YOLO: 100, Singles: 100 };
      let lastStrategies = null;
      let oddsFormatAmerican = false;

           // Helper: Parse Odds (Decimal or American) to Decimal
      function parseOddsToDecimal(val) {
        if (!val) return 0;
        const o = parseFloat(val);
        if (isNaN(o)) return 0;
        
        // American Negative (e.g. -150) -> 1 + (100 / 150) = 1.66
        if (o <= -100) return 1 + (100 / Math.abs(o));
        
        // American Positive (e.g. +150) -> 1 + (150 / 100) = 2.50
        if (o >= 100) return 1 + (o / 100);
        
        // Decimal (e.g. 1.91)
        if (o > 1) return o;
        
        return 0; // Invalid
      }

      // Helper: Convert Decimal to American (for display if needed)
      function toAmerican(dec) {
        if (!dec || dec <= 1) return "";
        if (dec >= 2) return "+" + Math.round((dec - 1) * 100);
        return Math.round(-100 / (dec - 1));
      }
      function formatOddsDisplay(decimalVal) {
        if (!decimalVal || decimalVal <= 1 || !Number.isFinite(decimalVal)) return "";
        if (oddsFormatAmerican) return toAmerican(decimalVal);
        return decimalVal.toFixed(2);
      }
      function parseDisplayedOdds(raw) {
        return parseOddsToDecimal(raw);
      }
      function validateConfig() {
        let valid = true;
        const fc = parseInt(fightCountEl.value);
        const br = parseFloat(bankrollEl.value);
        if (isNaN(fc) || fc < 1 || fc > 5) {
          fightCountError.textContent = "Number of fights must be between 1 and 5 (parlay combinations grow exponentially).";
          fightCountError.classList.remove("hidden");
          valid = false;
        } else {
          fightCountError.classList.add("hidden");
        }
        if (isNaN(br) || br <= 0) {
          bankrollError.classList.remove("hidden");
          valid = false;
        } else {
          bankrollError.classList.add("hidden");
        }
        return valid;
      }
      function formValid() {
        const rows = document.querySelectorAll("#fightsContainer > .fight-card");
        if (rows.length === 0) return false;
        let allGood = true;
        rows.forEach((row) => {
          const nameInput = row.querySelector(".fighter-name");
          const oddsInput = row.querySelector(".fighter-odds");
          const confInput = row.querySelector(".fighter-confidence");
          const errName = row.querySelector(".error-name");
          const errOdds = row.querySelector(".error-odds");
          const errConf = row.querySelector(".error-confidence");
          if (!nameInput.value.trim()) {
            errName.textContent = "Name required";
            errName.classList.remove("hidden");
            allGood = false;
          } else {
            errName.classList.add("hidden");
          }
          const odds = parseOddsToDecimal(oddsInput.value);
          if (!odds || odds <= 1.0 || !Number.isFinite(odds)) {
            errOdds.textContent = oddsFormatAmerican ? "Valid American odds (e.g. -110, +200) required" : "Valid decimal odds > 1.00 required";
            errOdds.classList.remove("hidden");
            allGood = false;
          } else {
            errOdds.classList.add("hidden");
          }
          const conf = parseInt(confInput.value);
          if (isNaN(conf) || conf < 50 || conf > 100) {
            errConf.textContent = "Confidence 50-100 required";
            errConf.classList.remove("hidden");
            allGood = false;
          } else {
            errConf.classList.add("hidden");
          }
        });
        return allGood;
      }

      function calculateWinProbability(stats) {
          // Use Fightnomics Prior logic if available, else fallback to heuristic
          const FN = window.FN;
          if (FN && typeof FN.normalizeFighter === "function") {
              const n = FN.normalizeFighter(stats);
              // Calculate a simple performance-based probability for a single fighter relative to population
              // This is a rough estimate; true prob requires an opponent.
              let z = 0;
              const weights = FN.UFC?.weights?.perf || {};
              const statsMeta = FN.UFC?.stats || {};
              for (const k in weights) {
                  if (n[k] != null && statsMeta[k]) {
                      const zk = (n[k] - statsMeta[k].mu) / statsMeta[k].sigma;
                      z += zk * weights[k];
                  }
              }
              // Sigmoid centered at 0.5
              return Math.round((1 / (1 + Math.exp(-z * 2))) * 100);
          }
          
          // Heuristic Fallback
          let score = 50;
          if (!stats) return score;
          const totalFights = (stats.wins||0) + (stats.losses||0) + (stats.draws||0);
          if (totalFights > 0) {
              const winRate = (stats.wins||0) / totalFights;
              score += (winRate - 0.5) * 40; 
          }
          if (totalFights > 5) score += 5;
          return Math.min(95, Math.max(5, score));
      }

      function predictFightOutcome(fighterA, fighterB) {
          const FN = window.FN;
          if (FN && typeof FN.fightnomicsPrior === "function") {
              // High-fidelity Fightnomics Model
              const res = FN.fightnomicsPrior(fighterA, fighterB);
              const probA = res.pA * 100;
              const probB = res.pB * 100;
              
              let statusA = "neutral";
              let statusB = "neutral";
              
              // Fightnomics thresholds: 65% is a solid lead
              if (probA > 68) statusA = "lock";
              else if (probA < 32) statusA = "fade";
              
              if (probB > 68) statusB = "lock";
              else if (probB < 32) statusB = "fade";
              
              return { 
                  fighterAStatus: statusA, 
                  fighterBStatus: statusB, 
                  probA, 
                  probB,
                  signals: res.signals,
                  diagnostics: res.diagnostics
              };
          }

          // Legacy Heuristic Fallback
          let statusA = "neutral";
          let statusB = "neutral";
          if (!fighterA || !fighterB) return { fighterAStatus: statusA, fighterBStatus: statusB };
          let scoreA = calculateWinProbability(fighterA);
          let scoreB = calculateWinProbability(fighterB);
          const totalScore = scoreA + scoreB;
          const probA = (scoreA / totalScore) * 100;
          const probB = (scoreB / totalScore) * 100;
          if (probA > 65) statusA = "lock";
          else if (probA < 35) statusA = "fade";
          if (probB > 65) statusB = "lock";
          else if (probB < 35) statusB = "fade";
          return { fighterAStatus: statusA, fighterBStatus: statusB, probA, probB };
      }
      
      // --- SOUND EFFECTS ---
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      function playClickSound() {
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(800, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(300, audioCtx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.1);
      }

      // Attach sound to all buttons
      document.addEventListener('click', (e) => {
          if (e.target.tagName === 'BUTTON' || e.target.closest('button') || e.target.classList.contains('autocomplete-item')) {
              playClickSound();
          }
      });

      // --- PREDICTION ENGINE END ---

      // --- CHARTING ENGINE ---
      let activeCharts = new Map();
      let mcWorkerPool = [];
      const MAX_WORKERS = Math.min(navigator.hardwareConcurrency || 4, 4);

      // IntersectionObserver for virtualized/lazy chart rendering
      const chartObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const canvas = entry.target;
            const renderFn = canvas._renderFn;
            if (renderFn) {
              renderFn();
              // Once rendered, we can stop observing if it's static, 
              // but these might update, so we keep observing.
            }
          }
        });
      }, { threshold: 0.1 });

      function destroyChartsInContainer(container) {
        if (!container) return;
        const canvases = container.querySelectorAll('canvas');
        canvases.forEach(canvas => {
          chartObserver.unobserve(canvas);
          if (activeCharts.has(canvas)) {
            activeCharts.get(canvas).destroy();
            activeCharts.delete(canvas);
          }
        });
      }

      function getMCWorker() {
        // Simple round-robin worker selection
        if (mcWorkerPool.length < MAX_WORKERS) {
          const w = new Worker('js/mc-worker.js');
          mcWorkerPool.push(w);
          return w;
        }
        const worker = mcWorkerPool.shift();
        mcWorkerPool.push(worker);
        return worker;
      }

      function runMonteCarloInWorker(fights, rows, bankroll, trials) {
        return new Promise((resolve) => {
          const worker = getMCWorker();
          const onMessage = (e) => {
            if (e.data.type === 'result') {
              worker.removeEventListener('message', onMessage);
              resolve(e.data.result);
            }
          };
          worker.addEventListener('message', onMessage);
          
          const precomputedFights = fights.map(f => {
            const [a, b] = computeFightProbabilities(f);
            return { a, b };
          });

          worker.postMessage({
            taskType: 'simulate',
            fights: precomputedFights,
            rows,
            bankroll,
            trials
          });
        });
      }

      function initRadarChart(canvas, statsA, statsB, labelA, labelB) {
        if (!canvas) return;
        
        canvas._renderFn = () => {
          if (activeCharts.has(canvas)) {
            activeCharts.get(canvas).destroy();
          }

          const perfKeys = ["slpm", "stracc", "sapm", "strdef", "td15m", "tdacc", "tddef", "sub15m"];
          const labels = ["SLpM", "Str. Acc %", "SApM", "Str. Def %", "TD / 15m", "TD Acc %", "TD Def %", "Sub / 15m"];
          
          const dataA = perfKeys.map(k => {
            const val = statsA?.[k];
            if (typeof val !== 'number') return 0;
            const meta = FN?.UFC?.stats?.[k];
            const max = meta ? meta.mu + 3 * meta.sigma : 100;
            return (val / max) * 100;
          });

          const dataB = perfKeys.map(k => {
            const val = statsB?.[k];
            if (typeof val !== 'number') return 0;
            const meta = FN?.UFC?.stats?.[k];
            const max = meta ? meta.mu + 3 * meta.sigma : 100;
            return (val / max) * 100;
          });

          const ctx = canvas.getContext('2d');
          const chart = new Chart(ctx, {
            type: 'radar',
            data: {
              labels: labels,
              datasets: [
                {
                  label: labelA || 'Fighter A',
                  data: dataA,
                  fill: true,
                  backgroundColor: 'rgba(217, 119, 87, 0.2)',
                  borderColor: '#d97757',
                  pointBackgroundColor: '#d97757',
                  pointBorderColor: '#faf9f5',
                  pointHoverBackgroundColor: '#faf9f5',
                  pointHoverBorderColor: '#d97757',
                  borderWidth: 2,
                  pointRadius: 3,
                  tension: 0.15
                },
                {
                  label: labelB || 'Fighter B',
                  data: dataB,
                  fill: true,
                  backgroundColor: 'rgba(106, 155, 204, 0.2)',
                  borderColor: '#6a9bcc',
                  pointBackgroundColor: '#6a9bcc',
                  pointBorderColor: '#faf9f5',
                  pointHoverBackgroundColor: '#faf9f5',
                  pointHoverBorderColor: '#6a9bcc',
                  borderWidth: 2,
                  pointRadius: 3,
                  tension: 0.15
                }
              ]
            },
            options: {
              responsive: true,
              maintainAspectRatio: true,
              aspectRatio: 1,
              scales: {
                r: {
                  angleLines: { color: 'rgba(250, 249, 245, 0.05)' },
                  grid: { color: 'rgba(250, 249, 245, 0.05)' },
                  pointLabels: {
                    color: '#b0aea5',
                    font: { family: 'Poppins', size: 10, weight: '600' }
                  },
                  ticks: { display: false, max: 100, min: 0, stepSize: 25 },
                  suggestedMin: 0,
                  suggestedMax: 100
                }
              },
              plugins: {
                legend: {
                  display: true,
                  position: 'bottom',
                  labels: {
                    color: '#faf9f5',
                    font: { family: 'Poppins', size: 11, weight: '700' },
                    usePointStyle: true,
                    pointStyle: 'rectRounded',
                    padding: 15
                  }
                },
                tooltip: {
                  backgroundColor: 'rgba(20, 20, 19, 0.95)',
                  titleFont: { family: 'Poppins', size: 12, weight: 'bold' },
                  bodyFont: { family: 'Lora', size: 11 },
                  borderColor: 'rgba(255, 255, 255, 0.1)',
                  borderWidth: 1,
                  padding: 10,
                  cornerRadius: 6,
                  callbacks: {
                    label: (context) => ` ${context.dataset.label}: ${context.raw.toFixed(1)}% of Peak`
                  }
                }
              }
            }
          });

          activeCharts.set(canvas, chart);
        };

        chartObserver.observe(canvas);
      }

      function initStrategyRadar(canvas, datasets) {
        if (!canvas) return;
        
        canvas._renderFn = () => {
          if (activeCharts.has(canvas)) activeCharts.get(canvas).destroy();

          const ctx = canvas.getContext('2d');
          const chart = new Chart(ctx, {
            type: 'radar',
            data: {
              labels: ["EV", "Win Prob", "Exposure", "Stability", "Safe Tail"],
              datasets: datasets
            },
            options: {
              responsive: true,
              maintainAspectRatio: true,
              aspectRatio: 1,
              scales: {
                r: {
                  angleLines: { color: 'rgba(250, 249, 245, 0.1)' },
                  grid: { color: 'rgba(250, 249, 245, 0.05)' },
                  pointLabels: {
                    color: '#b0aea5',
                    font: { family: 'Poppins', size: 9, weight: '700' }
                  },
                  ticks: { display: false, max: 100, min: 0 },
                  suggestedMin: 0,
                  suggestedMax: 100
                }
              },
              plugins: {
                legend: {
                  display: true,
                  position: 'bottom',
                  labels: {
                    color: '#faf9f5',
                    font: { family: 'Poppins', size: 9, weight: '600' },
                    usePointStyle: true,
                    pointStyle: 'circle',
                    padding: 10
                  }
                },
                tooltip: {
                  backgroundColor: 'rgba(20, 20, 19, 0.95)',
                  titleFont: { family: 'Poppins', size: 11, weight: 'bold' },
                  bodyFont: { family: 'Lora', size: 10 },
                  callbacks: {
                    label: (context) => ` ${context.dataset.label}: ${context.raw.toFixed(1)}% Score`
                  }
                }
              }
            }
          });
          activeCharts.set(canvas, chart);
        };

        chartObserver.observe(canvas);
      }

      function drawMonteCarloDistribution(canvas, results, bankroll) {
        if (!canvas || !results || results.length === 0) return;

        canvas._renderFn = () => {
          // Assume results are already sorted for performance (done in runMonteCarloAsync)
          const sorted = results;
          const min = sorted[0];
          const max = sorted[sorted.length - 1];
          const binCount = 50; 
          const binWidth = Math.max(0.1, (max - min) / binCount);
          const bins = new Array(binCount).fill(0);
          
          results.forEach(val => {
            let b = Math.floor((val - min) / binWidth);
            if (b >= binCount) b = binCount - 1;
            if (b < 0) b = 0;
            bins[b]++;
          });

          const labels = new Array(binCount).fill(0).map((_, i) => min + i * binWidth);

          if (activeCharts.has(canvas)) {
            const chart = activeCharts.get(canvas);
            chart.data.labels = labels;
            chart.data.datasets[0].data = bins;
            chart.update('none'); 
            return;
          }

          const ctx = canvas.getContext('2d');
          const chart = new Chart(ctx, {
            type: 'line',
            data: {
              labels: labels,
              datasets: [{
                label: 'Frequency',
                data: bins,
                fill: true,
                backgroundColor: (context) => {
                  const chart = context.chart;
                  const {ctx, chartArea} = chart;
                  if (!chartArea) return null;
                  const gradient = ctx.createLinearGradient(chartArea.left, 0, chartArea.right, 0);
                  labels.forEach((val, i) => {
                    const pos = Math.max(0, Math.min(1, i / (binCount - 1)));
                    if (val < 0) gradient.addColorStop(pos, 'rgba(217, 119, 87, 0.35)'); // Anthropic Orange
                    else gradient.addColorStop(pos, 'rgba(120, 140, 93, 0.35)');   // Anthropic Green
                  });
                  return gradient;
                },
                borderColor: (context) => {
                  const chart = context.chart;
                  const {ctx, chartArea} = chart;
                  if (!chartArea) return null;
                  const gradient = ctx.createLinearGradient(chartArea.left, 0, chartArea.right, 0);
                  labels.forEach((val, i) => {
                    const pos = Math.max(0, Math.min(1, i / (binCount - 1)));
                    if (val < 0) gradient.addColorStop(pos, '#d97757'); // Anthropic Orange
                    else gradient.addColorStop(pos, '#788c5d');   // Anthropic Green
                  });
                  return gradient;
                },
                borderWidth: 2,
                tension: 0.4,
                pointRadius: 0,
                pointHitRadius: 10
              }]
            },
            options: {
              responsive: true,
              maintainAspectRatio: true,
              aspectRatio: 4,
              layout: { padding: { top: 5, bottom: 5 } },
              scales: {
                x: {
                  display: true,
                  grid: { display: false, drawBorder: false },
                  ticks: {
                    display: true,
                    color: '#b0aea5',
                    font: { family: 'Poppins', size: 8, weight: '600' },
                    callback: function(value, index) {
                      const val = labels[index];
                      if (index === 0 || index === binCount - 1) return money(val);
                      if (val > -binWidth && val < binWidth) return 'BE';
                      return '';
                    },
                    maxRotation: 0,
                    autoSkip: false
                  }
                },
                y: {
                  display: false,
                  beginAtZero: true
                }
              },
              plugins: {
                legend: { display: false },
                tooltip: {
                  enabled: true,
                  mode: 'index',
                  intersect: false,
                  backgroundColor: 'rgba(20, 20, 19, 0.95)',
                  titleFont: { family: 'Poppins', size: 12, weight: '800' },
                  bodyFont: { family: 'Lora', size: 11 },
                  borderColor: 'rgba(255, 255, 255, 0.1)',
                  borderWidth: 1,
                  padding: 10,
                  cornerRadius: 6,
                  displayColors: false,
                  callbacks: {
                    title: (items) => `Expected P/L: ${money(labels[items[0].dataIndex])}`,
                    label: (item) => {
                      const val = labels[item.dataIndex];
                      const count = item.raw;
                      const pct = ((count / results.length) * 100).toFixed(1);
                      return [
                        ` Frequency: ${count} trials (${pct}%)`,
                        val < 0 ? ' Status: NET LOSS' : ' Status: PROFIT'
                      ];
                    }
                  }
                }
              }
            }
          });

          activeCharts.set(canvas, chart);
        };

        chartObserver.observe(canvas);
      }

      function drawPortfolioChart(canvas, bets) {
        if (!canvas || !bets || bets.length === 0) return;

        let cumulative = 0;
        const data = bets.map(b => {
          const outcome = b.outcome || b.status; 
          if (outcome === 'WIN') cumulative += (b.stake * b.odds - b.stake);
          else if (outcome === 'LOSS') cumulative -= b.stake;
          return cumulative;
        });

        const labels = bets.map((_, i) => `Card #${i + 1}`);

        if (activeCharts.has(canvas)) {
          const chart = activeCharts.get(canvas);
          chart.data.labels = labels;
          chart.data.datasets[0].data = data;
          chart.update();
          return;
        }

        const ctx = canvas.getContext('2d');
        const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height || 200);
        gradient.addColorStop(0, 'rgba(106, 155, 204, 0.25)'); // Anthropic Blue
        gradient.addColorStop(1, 'rgba(106, 155, 204, 0)');

        const chart = new Chart(ctx, {
          type: 'line',
          data: {
            labels: labels,
            datasets: [{
              label: 'Portfolio Equity',
              data: data,
              fill: true,
              backgroundColor: gradient,
              borderColor: '#6a9bcc', // Anthropic Blue
              borderWidth: 2.5,
              tension: 0.4,
              pointRadius: 4,
              pointBackgroundColor: '#6a9bcc',
              pointBorderColor: '#141413',
              pointBorderWidth: 2,
              pointHoverRadius: 6,
              pointHoverBackgroundColor: '#faf9f5',
              pointHoverBorderColor: '#6a9bcc',
              pointHoverBorderWidth: 2
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: 2.5,
            interaction: {
              intersect: false,
              mode: 'index',
            },
            scales: {
              x: {
                grid: { display: false, drawBorder: false },
                ticks: { color: '#b0aea5', font: { family: 'Poppins', size: 10, weight: '600' } }
              },
              y: {
                grid: { color: 'rgba(255, 255, 255, 0.05)', drawBorder: false },
                ticks: { 
                  color: '#b0aea5', 
                  font: { family: 'mono', size: 10 },
                  callback: (value) => money(value)
                }
              }
            },
            plugins: {
              legend: { display: false },
              tooltip: {
                backgroundColor: 'rgba(20, 20, 19, 0.95)',
                titleFont: { family: 'Poppins', size: 12, weight: 'bold' },
                bodyFont: { family: 'Lora', size: 11 },
                borderColor: 'rgba(255, 255, 255, 0.1)',
                borderWidth: 1,
                padding: 12,
                cornerRadius: 8,
                callbacks: {
                  label: (item) => ` Equity: ${money(item.raw)}`,
                  title: (items) => `After ${items[0].label}`
                }
              }
            }
          }
        });
        activeCharts.set(canvas, chart);
      }

      // Selection Logic for Upcoming Feed
      function toggleUpcomingFightSelection(evIdx, fightIdx, fightObj, eventObj, element) {
          const key = `${evIdx}:${fightIdx}`;
          if (upcomingSelected.has(key)) {
              upcomingSelected.delete(key);
              element.classList.remove('selected');
              element.setAttribute('aria-checked', 'false');
          } else {
              if (upcomingSelected.size >= 5) {
                if (typeof toast === "function") toast("⚠️ Maximum 5 fights can be selected for a parlay.");
                return;
              }
              upcomingSelected.set(key, { fight: fightObj, event: eventObj });
              element.classList.add('selected');
              element.setAttribute('aria-checked', 'true');
              
              // Pulse effect on selection
              element.classList.add('pulse-indicator');
              setTimeout(() => element.classList.remove('pulse-indicator'), 2000);
          }
          if (typeof playSoftClickSound === "function") playSoftClickSound();
          updateUpcomingSelectionBar();
      }

      function updateUpcomingSelectionBar() {
          const bar = document.getElementById('upcomingSelectionBar');
          const countEl = document.getElementById('upcSelectedCount');
          if (!bar || !countEl) return;
          
          const count = upcomingSelected.size;
          countEl.textContent = String(count);
          
          if (count > 0) {
              bar.classList.add('active');
          } else {
              bar.classList.remove('active');
          }
      }

      function clearUpcomingSelection() {
          upcomingSelected.clear();
          document.querySelectorAll('.upc-fight-row.selected').forEach(el => el.classList.remove('selected'));
          updateUpcomingSelectionBar();
      }

      function buildFromSelected() {
          if (upcomingSelected.size === 0) return;
          
          const selectedArray = Array.from(upcomingSelected.values());
          const N = Math.min(5, selectedArray.length);
          
          // Update fight count input
          const fcInput = document.getElementById("fightCount");
          if (fcInput) {
              fcInput.value = String(N);
              fcInput.dispatchEvent(new Event("change", { bubbles: true }));
          }

          setTimeout(() => {
              const mainCards = document.querySelectorAll('#fightsContainer .rounded-2xl.w-full');
              if (!mainCards || !mainCards.length) return;

              let filled = 0;
              for (let i = 0; i < mainCards.length && filled < N; i++) {
                  const item = selectedArray[i];
                  const f = item.fight;
                  const event = item.event;
                  
                  let fA = null, fB = null, oddA = 0, oddB = 0;
                  if (Array.isArray(f.fighters) && f.fighters.length >= 2) {
                      if (typeof f.fighters[0] === "string") {
                          fA = { name: f.fighters[0] };
                          fB = { name: f.fighters[1] };
                          // Odds extraction
                          if (Array.isArray(f._odds) && f._odds.length === 2) {
                              oddA = Number(f._odds[0]) || 0; oddB = Number(f._odds[1]) || 0;
                          } else if (Array.isArray(f.decimalOdds) && f.decimalOdds.length === 2) {
                              oddA = Number(f.decimalOdds[0]) || 0; oddB = Number(f.decimalOdds[1]) || 0;
                          } else if (Array.isArray(f.market) && f.market.length === 2) {
                              oddA = Number(f.market[0]) || 0; oddB = Number(f.market[1]) || 0;
                          }
                      } else {
                          fA = f.fighters[0] || {}; fB = f.fighters[1] || {};
                          oddA = Number(fA.decimalOdds) || Number(fA.odds) || 0;
                          oddB = Number(fB.decimalOdds) || Number(fB.odds) || 0;
                      }
                  }
                  
                  if (!fA || !fB || !fA.name || !fB.name) continue;

                  const mc = mainCards[i];
                  const names = mc.querySelectorAll(".fighter-name");
                  const odds  = mc.querySelectorAll(".fighter-odds");
                  const confs = mc.querySelectorAll(".fighter-confidence");

                  if (names[0]) { 
                      names[0].value = fA.name; 
                      const bioA = resolveFighterBio(fA.name);
                      if (bioA && bioA.stats) names[0].dataset.fighterStats = JSON.stringify(bioA.stats);
                      names[0].dispatchEvent(new Event("input", { bubbles: true })); 
                      names[0].dispatchEvent(new Event("blur",  { bubbles: true })); 
                  }
                  if (names[1]) { 
                      names[1].value = fB.name; 
                      const bioB = resolveFighterBio(fB.name);
                      if (bioB && bioB.stats) names[1].dataset.fighterStats = JSON.stringify(bioB.stats);
                      names[1].dispatchEvent(new Event("input", { bubbles: true })); 
                      names[1].dispatchEvent(new Event("blur",  { bubbles: true })); 
                  }
                  
                  if (odds[0] && oddA >= 1.01) { odds[0].value = oddA.toFixed(2); odds[0].dispatchEvent(new Event("blur", { bubbles: true })); }
                  if (odds[1] && oddB >= 1.01) { odds[1].value = oddB.toFixed(2); odds[1].dispatchEvent(new Event("blur", { bubbles: true })); }
                  
                  [0,1].forEach(j => {
                      const c = confs[j]; if (!c) return;
                      const d = j === 0 ? oddA : oddB;
                      if (d >= 1.01) {
                          const implied = 1 / d;
                          c.value = Math.max(50, Math.min(99, Math.round(implied * 100)));
                      } else { c.value = 75; }
                      c.dispatchEvent(new Event("input", { bubbles: true }));
                  });
                  filled++;
              }

              if (filled > 0) {
                  toast(`✅ Built card with ${filled} selected fights.`);
                  clearUpcomingSelection();
                  const configSection = document.querySelector('.lg\\:col-span-8 > .rounded-2xl.border.border-white\\/10');
                  if (configSection) configSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  mainCards.forEach((mc, idx) => {
                      if (idx < filled) {
                          mc.classList.add('ring-2', 'ring-anthropic-orange', 'ring-opacity-50', 'transition-all');
                          setTimeout(() => mc.classList.remove('ring-2', 'ring-anthropic-orange', 'ring-opacity-50'), 1500);
                      }
                  });
              }
          }, 300);
      }

      function resolveFighterBio(name) {
        // Tiered: BUNDLE > MANUAL > fuzzy BUNDLE > empty.
        if (!name) return null;
        const FN = window.FN;
        const B = window.FIGHTER_STATS_BUNDLE || {};
        // strip meta
        const bundle = Object.fromEntries(Object.entries(B).filter(([k]) => k !== "__meta"));
        let exact = bundle[name] || null;
        let fuzzy = null;
        if (!exact && FN && typeof FN.fuzzyFighterLookup === "function") {
          fuzzy = FN.fuzzyFighterLookup(name, bundle, 0.90);
          if (fuzzy) exact = bundle[fuzzy.name] || null;
        }
        let manual = fighterStatsMap[name] || null;
        if (!manual && fuzzy) manual = fighterStatsMap[fuzzy.name] || null;
        if (!manual && !exact) {
          // Nothing found; return a minimal shell for Tale of the Tape to gracefully degrade
          return { name, source: "none", stats: null, fuzzyMatch: null };
        }
        const merged = Object.assign(
          { name, nickname: null, stance: null, height_cm: null, reach_cm: null, wins: null, losses: null, draws: 0, dob: null, weight_class: null },
          manual ? manualSchemaToBundleSchema(manual) : {},
          exact || {},
        );

        // Calculate Match Quality
        let matchQuality = exact ? 100 : (fuzzy ? Math.round(fuzzy.dice * 100) : 0);
        let confidenceColor = matchQuality >= 95 ? "#788c5d" : (matchQuality >= 80 ? "#6a9bcc" : "#d97757");

        return {
          name: merged.name || name,
          source: exact ? (manual ? "bundle+manual" : "bundle") : (manual ? "manual" : "none"),
          fuzzyMatch: fuzzy,
          matchQuality,
          confidenceColor,
          stats: merged,
        };
      }
      function manualSchemaToBundleSchema(m) {
        const out = {};
        if (m.nickname != null) out.nickname = m.nickname;
        if (m.stance != null)   out.stance   = m.stance;
        if (m.wins   != null)   out.wins     = m.wins|0;
        if (m.losses != null)   out.losses   = m.losses|0;
        if (m.draws  != null)   out.draws    = m.draws|0;
        if (m.height != null)   out.height_cm = _parseLengthCm(m.height);
        if (m.reach  != null)   out.reach_cm  = _parseLengthCm(m.reach);
        return out;
      }
      function _parseLengthCm(v) {
        if (v == null) return null;
        if (typeof v === "number") return v;
        const s = String(v).trim().toLowerCase();
        const n = parseFloat(s);
        if (!Number.isFinite(n)) return null;
        if (s.includes("in") || s.includes('"')) return +(n * 2.54).toFixed(1);
        return n;
      }

      /**
       * Unified Search Function
       * Strategy: Fighter-STATS BUNDLE → Manual DB (Instant) → TheSportsDB → Basic List Fallback
       */
      async function searchFightersAPI(query) {
          if (!query || query.length < 2) return [];
          const qLower = query.toLowerCase();

          // 0. Bundle tier (highest priority)
          const bundle = (window.FIGHTER_STATS_BUNDLE && window.FIGHTER_STATS_BUNDLE.__meta) ? window.FIGHTER_STATS_BUNDLE : null;
          if (bundle) {
            const names = Object.keys(bundle).filter(k => k !== "__meta");
            const bundleMatches = names.filter(n => n.toLowerCase().includes(qLower)).slice(0, 10);
            const FN = window.FN;
            const fuzzyCandidates = [];
            if (bundleMatches.length === 0 && FN && typeof FN.fuzzyFighterLookup === "function") {
              const ff = FN.fuzzyFighterLookup(query, Object.fromEntries(names.map(n=>[n,1])), 0.88);
              if (ff && ff.name) fuzzyCandidates.push(ff.name);
            }
            const namesToEmit = [...new Set([...bundleMatches, ...fuzzyCandidates])].slice(0, 8);
            if (namesToEmit.length > 0) {
              return namesToEmit.map(n => {
                const b = bundle[n];
                const m = (fighterStatsMap && fighterStatsMap[n]) || {};
                const recStr = (b.wins != null) ? `${b.wins}-${b.losses}-${b.draws||0}` : (m.wins != null ? `${m.wins}-${m.losses}-${m.draws||0}` : "—");
                return Object.assign({
                  name: n,
                  source: "bundle",
                  __bundleHit: true,
                  __fuzzy: (fuzzyCandidates[0] === n) ? true : false,
                  division: b.weight_class || "",
                  record: recStr,
                }, b, m);
              });
            }
          }

          // 1. Check Manual Stats Map First (Fastest & Most Accurate)
          // We convert the Map to an Array of objects on the fly for search
          const localMatches = Object.keys(fighterStatsMap)
              .filter(name => name.toLowerCase().includes(qLower))
              .map(name => ({
                  name,
                  ...fighterStatsMap[name],
                  source: 'manual' // Tag source for debugging
              }));

          if (localMatches.length > 0) return localMatches;

          // 2. Check Cache
          if (fighterCache.has(qLower)) return fighterCache.get(qLower);

          try {
              // 3. Try TheSportsDB (Real Bio Data)
              // Note: Free key '3' is rate limited, but works for demos.
              const res = await fetch(`https://www.thesportsdb.com/api/v1/json/3/searchplayers.php?p=${encodeURIComponent(query)}`);
              const data = await res.json();

              if (data && data.player && data.player.length > 0) {
                  // Filter for Fighting/MMA
                  const fighters = data.player.filter(p => p.strSport === "Fighting" || p.strSport === "MMA");

                  if (fighters.length > 0) {
                      const results = fighters.map(f => {
                          // Parse Height (e.g., "6 ft 4 in (1.93 m)" -> "193cm")
                          let h = f.strHeight;
                          if (h && h.includes("m)")) {
                              const match = h.match(/\(([\d\.]+) m\)/);
                              if (match) h = Math.round(parseFloat(match[1]) * 100) + "cm";
                          } else if (h && h.includes("m")) {
                              h = Math.round(parseFloat(h) * 100) + "cm";
                          }

                          return {
                              name: f.strPlayer,
                              nickname: null, // TheSportsDB doesn't always have strNickname easily accessible in this view
                              wins: null, // Record not in search
                              losses: null,
                              draws: 0,
                              height: h || null,
                              reach: null, // Reach not in search
                              stance: null,
                              id: f.idPlayer,
                              thumb: f.strThumb,
                              status: f.strStatus, // "Active" or "Retired"
                              source: 'api'
                          };
                      });
                      fighterCache.set(qLower, results);
                      return results;
                  }
              }
          } catch (e) {
              console.warn("API Error, falling back to basic DB:", e);
          }

          // 4. Fallback to basic DB (Names only)
          return fightersDB
                .filter(name => name.toUpperCase().includes(query.toUpperCase()))
                .slice(0, 5)
                .map(name => ({ name: name, wins: null, source: 'fallback' }));
      }

      // Legacy image fetcher (TheSportsDB) for avatars
      async function fetchFighterImage(name) {
          try {
              const res = await fetch(`https://www.thesportsdb.com/api/v1/json/3/searchplayers.php?p=${encodeURIComponent(name)}`);
              const data = await res.json();
              if (data.player && data.player.length > 0) {
                  return data.player[0].strCutout || data.player[0].strThumb || null;
              }
          } catch (e) { console.error("Image API Error", e); }
          return null;
      }

      // Updated Autocomplete to use Live API
      function autocomplete(inp) {
        let currentFocus;
        let debounceTimer;

        inp.addEventListener("blur", function() {
            // Close list after a short delay to allow clicks
            setTimeout(() => closeAllLists(), 200);
            
            const val = this.value.trim();
            const mainCard = this.closest('.rounded-2xl.w-full');
            
            if (!val) {
                this.dataset.fighterStats = "";
                if (mainCard) {
                    const s = getCurrentCardState(mainCard);
                    renderPartialStatsOnly(mainCard, s.statsA, s.statsB, s.oA, s.oB);
                    renderFightnomicsCalibration(mainCard, s.statsA, s.statsB, s.oA, s.oB, s.cA, s.cB);
                }
                return;
            }
            
            // If we already have stats for this exact name, skip resolution
            try {
                if (this.dataset.fighterStats) {
                    const s = JSON.parse(this.dataset.fighterStats);
                    if (s.name === val) return;
                }
            } catch(e) {}

            // Resolve bio for the current text
            const bio = resolveFighterBio(val);
            if (bio && bio.stats) {
                this.dataset.fighterStats = JSON.stringify(bio.stats);
                // Trigger UI update
                if (mainCard) {
                    const s = getCurrentCardState(mainCard);
                    if (s.statsA && s.statsB) {
                        renderTaleOfTheTape(mainCard, s.statsA, s.statsB, s.oA, s.oB);
                        renderFightnomicsCalibration(mainCard, s.statsA, s.statsB, s.oA, s.oB, s.cA, s.cB);
                    } else {
                        renderPartialStatsOnly(mainCard, s.statsA, s.statsB, s.oA, s.oB);
                        renderFightnomicsCalibration(mainCard, s.statsA, s.statsB, s.oA, s.oB, s.cA, s.cB);
                    }
                }
            }
        });

        inp.addEventListener("input", function(e) {
            const val = this.value;
            closeAllLists();
            
            // If the user clears the name, clear stats immediately
            if (!val) {
                this.dataset.fighterStats = "";
                const mainCard = this.closest('.rounded-2xl.w-full');
                if (mainCard && typeof refreshCalibrationLive === "function") {
                    // refreshCalibrationLive is usually scoped inside buildFights, 
                    // but we can trigger it via event if needed.
                    // Actually, let's just trigger a custom event or use the closest mainCard to find the local refresh.
                }
            }
            
            if (!val) return false;
            
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(async () => {
                currentFocus = -1;
                
                // 1. Search API
                let results = await searchFightersAPI(val);
                
                // FALLBACK: Local DB if API fails or returns nothing
                if (results.length === 0) {
                     results = fightersDB
                        .filter(name => name.toUpperCase().includes(val.toUpperCase()))
                        .slice(0, 5)
                        .map(name => ({ name: name, wins: null })); // Minimal obj
                }

                if (results.length === 0) return;

                const a = document.createElement("DIV");
                a.setAttribute("id", inp.id + "autocomplete-list");
                a.setAttribute("class", "autocomplete-items");
                inp.parentNode.appendChild(a);

                results.slice(0, 5).forEach(fighter => {
                    const b = document.createElement("DIV");
                    b.className = "autocomplete-item";
                    
                    // Image Placeholder
                    const imgPlaceholder = document.createElement("div");
                    imgPlaceholder.className = "w-10 h-10 rounded-full bg-slate-700 flex-shrink-0 border border-white/10";
                    
                    // Text Info
                    const textDiv = document.createElement("div");
                    textDiv.className = "info";
                    const nick = fighter.nickname ? `"${fighter.nickname}" ` : "";
                    const recStr = (fighter.wins !== null && fighter.wins !== undefined) ? `${fighter.wins}-${fighter.losses}-${fighter.draws}` : "Record N/A";
                    const stanceStr = fighter.stance || "Stance N/A";
                    const statusBadge = fighter.status ? ` • <span class="${fighter.status === 'Active' ? 'text-green-400' : 'text-slate-500'}">${fighter.status}</span>` : "";
                    const record = `<span class="text-[10px] text-slate-400 block">${recStr} • ${stanceStr}${statusBadge}</span>`;
                    
                    textDiv.innerHTML = `<strong>${fighter.name}</strong> <span class="text-xs text-slate-400 italic">${nick}</span>${record}`;
                    
                    b.appendChild(imgPlaceholder);
                    b.appendChild(textDiv);

                    // Hidden Data for Selection
                    const hiddenInput = document.createElement("input");
                    hiddenInput.type = "hidden";
                    hiddenInput.value = fighter.name;
                    // Store extra metadata on the element itself
                    b.dataset.stats = JSON.stringify(fighter); 
                    
                    b.appendChild(hiddenInput);
                    
                    b.addEventListener("click", function(e) {
                        inp.value = this.getElementsByTagName("input")[0].value;
                        
                        try {
                            const stats = JSON.parse(this.dataset.stats);
                            inp.dataset.fighterStats = JSON.stringify(stats);
                            const mainCard = inp.closest('.rounded-2xl.w-full'); 
                            if (mainCard) {
                                const inputs = mainCard.querySelectorAll('.fighter-name');
                                if (inputs.length === 2) {
                                    const statsA = inputs[0].dataset.fighterStats ? JSON.parse(inputs[0].dataset.fighterStats) : null;
                                    const statsB = inputs[1].dataset.fighterStats ? JSON.parse(inputs[1].dataset.fighterStats) : null;
                                    if (statsA && statsB) {
                                        const outcome = predictFightOutcome(statsA, statsB);
                                        const selects = mainCard.querySelectorAll('.fighter-status');
                                        if (selects.length === 2) {
                                            selects[0].value = outcome.fighterAStatus;
                                            selects[1].value = outcome.fighterBStatus;
                                            selects[0].dispatchEvent(new Event('input'));
                                            selects[1].dispatchEvent(new Event('input'));
                                        }
                                        const oddsAEl = mainCard.querySelectorAll('.fighter-odds')[0];
                                        const oddsBEl = mainCard.querySelectorAll('.fighter-odds')[1];
                                        const oA = oddsAEl ? parseOddsToDecimal(oddsAEl.value) : null;
                                        const oB = oddsBEl ? parseOddsToDecimal(oddsBEl.value) : null;
                                        const confAEl = mainCard.querySelectorAll('.fighter-confidence')[0];
                                        const confBEl = mainCard.querySelectorAll('.fighter-confidence')[1];
                                        renderTaleOfTheTape(mainCard, statsA, statsB, oA, oB);
                                        renderFightnomicsCalibration(mainCard, statsA, statsB, oA, oB,
                                            confAEl ? parseInt(confAEl.value)||50 : 50,
                                            confBEl ? parseInt(confBEl.value)||50 : 50);
                                        attachCalibrationButtons(mainCard);
                                    } else {
                                        const oddsAEl = mainCard.querySelectorAll('.fighter-odds')[0];
                                        const oddsBEl = mainCard.querySelectorAll('.fighter-odds')[1];
                                        const oA = oddsAEl ? parseOddsToDecimal(oddsAEl.value) : null;
                                        const oB = oddsBEl ? parseOddsToDecimal(oddsBEl.value) : null;
                                        renderPartialStatsOnly(mainCard, statsA || null, statsB || null, oA, oB);
                                        renderFightnomicsCalibration(mainCard, statsA || null, statsB || null, oA, oB,
                                            50, 50);
                                    }
                                }
                            }
                        } catch(e) { console.error("Stats render error", e); }

                        inp.dispatchEvent(new Event('input')); 
                        closeAllLists();
                    });
                    a.appendChild(b);
                    
                    // Lazy Load Image (still using TheSportsDB for images as BallDontLie might not have them yet)
                    fetchFighterImage(fighter.name).then(url => {
                        if (url && document.body.contains(b)) {
                            const img = document.createElement("img");
                            img.src = url;
                            b.replaceChild(img, imgPlaceholder);
                        }
                    });
                });
            }, 300); // 300ms debounce
        });
        
        // ... keydown listeners remain same ...
        inp.addEventListener("keydown", function(e) {
            let x = document.getElementById(this.id + "autocomplete-list");
            if (x) x = x.getElementsByTagName("div");
            if (e.keyCode == 40) { // Down
              currentFocus++;
              addActive(x);
            } else if (e.keyCode == 38) { // Up
              currentFocus--;
              addActive(x);
            } else if (e.keyCode == 13) { // Enter
              e.preventDefault();
              if (currentFocus > -1 && x) x[currentFocus].click();
            }
        });
        function addActive(x) {
          if (!x) return false;
          removeActive(x);
          if (currentFocus >= x.length) currentFocus = 0;
          if (currentFocus < 0) currentFocus = (x.length - 1);
          x[currentFocus].classList.add("autocomplete-active");
        }
        function removeActive(x) {
          for (let i = 0; i < x.length; i++) {
            x[i].classList.remove("autocomplete-active");
          }
        }
        function closeAllLists(elmnt) {
          let x = document.getElementsByClassName("autocomplete-items");
          for (let i = 0; i < x.length; i++) {
            if (elmnt != x[i] && elmnt != inp) {
              x[i].parentNode.removeChild(x[i]);
            }
          }
        }
        document.addEventListener("click", function (e) {
            closeAllLists(e.target);
        });
      }

      function _parseLengthCm(v) {
        if (v == null) return null;
        if (typeof v === "number") return v;
        const m = String(v).match(/([\d.]+)/);
        return m ? parseFloat(m[1]) : null;
      }

      function getCurrentCardState(mainCard) {
        const inputs = mainCard.querySelectorAll('.fighter-name');
        const oddsEls = mainCard.querySelectorAll('.fighter-odds');
        const confEls = mainCard.querySelectorAll('.fighter-confidence');
        return {
          statsA: inputs?.[0]?.dataset?.fighterStats ? JSON.parse(inputs[0].dataset.fighterStats) : null,
          statsB: inputs?.[1]?.dataset?.fighterStats ? JSON.parse(inputs[1].dataset.fighterStats) : null,
          oA: oddsEls?.[0] ? parseOddsToDecimal(oddsEls[0].value) : null,
          oB: oddsEls?.[1] ? parseOddsToDecimal(oddsEls[1].value) : null,
          cA: confEls?.[0] ? parseInt(confEls[0].value) || 50 : 50,
          cB: confEls?.[1] ? parseInt(confEls[1].value) || 50 : 50
        };
      }

      function renderPartialStatsOnly(mainCard, statsA, statsB, oddsA, oddsB) {
        const tape = mainCard.querySelector('.tale-of-the-tape');
        if (!tape) return;

        const populateStats = (container, s, otherS, isRight) => {
          if (!container) return;
          const age = s?.dob ? (FN ? FN.ageFromDob(s.dob) : '—') : '—';
          const height = s?.height_cm ? `${(s.height_cm / 2.54).toFixed(0)}"` : (s?.height ? `${s.height}"` : '—');
          const reach = s?.reach_cm ? `${(s.reach_cm / 2.54).toFixed(0)}"` : (s?.reach ? `${s.reach}"` : '—');
          const record = s ? `${s.wins}-${s.losses}-${s.draws || 0}` : '—';
          const total = (s?.wins || 0) + (s?.losses || 0) + (s?.draws || 0);
          const winRateVal = total > 0 ? (s.wins / total) : 0;
          const winRate = total > 0 ? `${(winRateVal * 100).toFixed(0)}%` : '—';
          
          const alignClass = isRight ? "text-left" : "text-right";
          const flexClass = isRight ? "flex-row" : "flex-row-reverse";

          // Advantage logic
          const hasReachEdge = s?.reach_cm && otherS?.reach_cm && (s.reach_cm > otherS.reach_cm + 5);
          const hasWinRateEdge = total > 5 && (winRateVal > 0.7);

          container.innerHTML = `
            <div class="stat-item group hover:border-anthropic-orange/30 transition-all">
              <div class="stat-label ${alignClass}">Record</div>
              <div class="stat-value ${alignClass} flex items-center gap-2 ${flexClass}">
                ${record}
                ${hasWinRateEdge ? '<span class="text-[8px] px-1.5 py-0.5 rounded bg-anthropic-green/20 text-anthropic-green border border-anthropic-green/30 font-black italic">ELITE</span>' : ''}
              </div>
            </div>
            <div class="stat-item group hover:border-anthropic-orange/30 transition-all">
              <div class="stat-label ${alignClass}">Age / Height / Reach</div>
              <div class="stat-value ${alignClass} flex items-center gap-2 ${flexClass}">
                ${age} / ${height} / ${reach}
                ${hasReachEdge ? '<span class="text-[8px] px-1.5 py-0.5 rounded bg-anthropic-blue/20 text-anthropic-blue border border-anthropic-blue/30 font-black italic">REACH EDGE</span>' : ''}
              </div>
            </div>
            <div class="stat-item group hover:border-anthropic-orange/30 transition-all">
              <div class="stat-label ${alignClass}">Win Rate</div>
              <div class="stat-value ${alignClass}">${winRate}</div>
            </div>
            <div class="stat-item group hover:border-anthropic-orange/30 transition-all">
              <div class="stat-label ${alignClass}">Sig. Strikes / min</div>
              <div class="stat-value ${alignClass}">${s?.slpm || '—'}</div>
            </div>
          `;
        };

        populateStats(tape.querySelector('.fighter-a-stats'), statsA, statsB, false);
        populateStats(tape.querySelector('.fighter-b-stats'), statsB, statsA, true);

        // Win Probability Meter
        const probVal = tape.querySelector('.win-prob-val');
        const meterA = tape.querySelector('.win-meter-a');
        const meterB = tape.querySelector('.win-meter-b');
        if (probVal && meterA && meterB) {
            const outcome = predictFightOutcome(statsA, statsB);
            const pA = outcome.probA || 50;
            const pB = outcome.probB || 50;
            probVal.textContent = `${pA.toFixed(0)}% / ${pB.toFixed(0)}%`;
            meterA.style.width = `${pA}%`;
            meterB.style.width = `${pB}%`;
        }

        // Radar Chart Integration (Clear it if partial)
        const canvas = tape.querySelector('.radar-chart-canvas');
        if (canvas && activeCharts.has(canvas)) {
            activeCharts.get(canvas).destroy();
            activeCharts.delete(canvas);
        }

        const missingEl = tape.querySelector('.fn-missing-chip');
        if (missingEl) {
          missingEl.innerHTML = `<div class="flex items-center gap-2 justify-center italic opacity-70"><span class="w-2 h-2 rounded-full bg-anthropic-orange animate-pulse"></span> Awaiting second fighter for full statistical comparison…</div>`;
          missingEl.classList.remove('hidden');
        }

        const chipWrap = tape.querySelector('.fn-signal-chips');
        if (chipWrap) chipWrap.innerHTML = `<span class="text-[10px] text-anthropic-mid italic opacity-60">Complete both names to generate signals…</span>`;

        tape.classList.remove('hidden');
        tape.classList.add('animate-slide-in');
      }

      function renderTaleOfTheTape(mainCard, statsA, statsB, oddsA, oddsB) {
        const tape = mainCard.querySelector('.tale-of-the-tape');
        if (!tape) return;

        const FN = window.FN;
        const normA = statsA ? (FN ? FN.normalizeFighter(statsA) : statsA) : null;
        const normB = statsB ? (FN ? FN.normalizeFighter(statsB) : statsB) : null;

        // Update Physical Bars and Values
        const updateRow = (key, valA, valB, max) => {
          const rowA = tape.querySelector(`.val-a-${key}`);
          const rowB = tape.querySelector(`.val-b-${key}`);
          const barA = tape.querySelector(`.bar-a[class*="val-a-${key}"], .bar-a`); // Try to find specific or first
          // Actually, the bars are in order. Let's select them more reliably.
          
          if (rowA) rowA.textContent = valA || "—";
          if (rowB) rowB.textContent = valB || "—";
          
          // Find the specific bar for this key
          const parent = rowA?.closest('.tape-row');
          if (parent) {
            const bA = parent.querySelector('.bar-a');
            const bB = parent.querySelector('.bar-b');
            if (bA && bB && max > 0) {
                const nA = parseFloat(valA) || 0;
                const nB = parseFloat(valB) || 0;
                const pA = Math.min(100, (nA / max) * 50); // 50% is center
                const pB = Math.min(100, (nB / max) * 50);
                bA.style.width = `${pA}%`;
                bB.style.width = `${pB}%`;
                // Alignment: A is right-aligned in its half, B is left-aligned in its half
                bA.style.marginLeft = 'auto';
            }
          }
        };

        const getWinRate = (s) => {
          const total = (s?.wins || 0) + (s?.losses || 0) + (s?.draws || 0);
          return total > 0 ? (s.wins / total) : 0;
        };

        updateRow("reach", normA?.reach_cm ? `${(normA.reach_cm / 2.54).toFixed(0)}"` : null, normB?.reach_cm ? `${(normB.reach_cm / 2.54).toFixed(0)}"` : null, 84);
        updateRow("height", normA?.height_cm ? `${(normA.height_cm / 2.54).toFixed(0)}"` : null, normB?.height_cm ? `${(normB.height_cm / 2.54).toFixed(0)}"` : null, 80);
        updateRow("win-rate", (getWinRate(normA) * 100).toFixed(0) + "%", (getWinRate(normB) * 100).toFixed(0) + "%", 100);

        const ageA = tape.querySelector('.val-a-age');
        const ageB = tape.querySelector('.val-b-age');
        if (ageA) ageA.textContent = normA?.age || "—";
        if (ageB) ageB.textContent = normB?.age || "—";

        // Radar Chart
        const canvas = tape.querySelector('.radar-chart-canvas');
        if (canvas) {
            initRadarChart(canvas, normA, normB, normA?.name, normB?.name);
        }

        const chipWrap = tape.querySelector('.fn-signal-chips');
        const missingEl = tape.querySelector('.fn-missing-chip');
        const fuzzyPill = tape.querySelector('.fn-fuzzy-pill');
        const anyFuzzy = (statsA?.__fuzzy || statsB?.__fuzzy);
        
        if (fuzzyPill) fuzzyPill.innerHTML = anyFuzzy ? `<span class="px-2 py-0.5 rounded-full border border-anthropic-orange/40 bg-anthropic-orange/10 text-anthropic-orange text-[10px] font-bold uppercase tracking-widest">Fuzzy Match</span>` : "";
        
        if (!FN || !normA || !normB) {
          if (chipWrap) chipWrap.innerHTML = `<span class="text-[10px] text-anthropic-mid italic opacity-60">Awaiting matchup data…</span>`;
          tape.classList.remove('hidden');
          return;
        }

        const context = { oddsA: (oddsA && isFinite(oddsA) && oddsA>1) ? oddsA : null, oddsB: (oddsB && isFinite(oddsB) && oddsB>1) ? oddsB : null };
        let prior;
        try {
          prior = FN.fightnomicsPrior(normA, normB, context);
        } catch(err) {
          if (chipWrap) chipWrap.innerHTML = `<span class="text-[10px] text-anthropic-orange italic opacity-70">Prior calculation error</span>`;
          tape.classList.remove('hidden');
          return;
        }

        // Update Prior Visualization
        const priorAEl = tape.querySelector('.fn-prior-a');
        const priorBEl = tape.querySelector('.fn-prior-b');
        const priorKnob = tape.querySelector('.fn-prior-knob');
        const priorCap = tape.querySelector('.fn-prior-caption');
        
        if (priorAEl) priorAEl.textContent = (prior.pA * 100).toFixed(1) + "%";
        if (priorBEl) priorBEl.textContent = (prior.pB * 100).toFixed(1) + "%";
        if (priorKnob) priorKnob.style.width = (prior.pA * 100) + "%";
        if (priorCap) priorCap.textContent = `Fightnomics Prior: ${prior.pA > 0.5 ? normA.name : normB.name} is the statistical favorite.`;

        const missingCount = (prior.diagnostics?.missingFeatures || 0) + (prior.diagnostics?.missingFeaturesB || 0);
        const totalFeatures = (prior.diagnostics?.totalFeatures || 1);
        const fillRate = 1 - (missingCount / totalFeatures);
        
        if (missingEl) {
          if (fillRate < 0.4) {
            missingEl.innerHTML = `<div class="flex items-center gap-2 justify-center"><span class="w-2 h-2 rounded-full bg-anthropic-orange animate-pulse"></span> Low Data Confidence: ${(fillRate*100).toFixed(0)}% Features Imputed</div>`;
            missingEl.classList.remove('hidden');
          } else if (fillRate < 0.7) {
            missingEl.innerHTML = `<div class="flex items-center gap-2 justify-center"><span class="w-2 h-2 rounded-full bg-anthropic-mid"></span> Partial Data: ${(fillRate*100).toFixed(0)}% Features Mapped</div>`;
            missingEl.classList.remove('hidden');
          } else {
            missingEl.classList.add('hidden');
          }
        }

        const sorted = [...(prior.signals || [])].sort((x,y) => Math.abs(y.magnitude) - Math.abs(x.magnitude));
        if (chipWrap) {
          if (sorted.length === 0) {
            chipWrap.innerHTML = `<span class="text-[10px] text-anthropic-mid italic opacity-60">No significant statistical variance detected.</span>`;
          } else {
            chipWrap.innerHTML = sorted.map(s => {
              const favA = s.magnitude > 0;
              const absMag = Math.abs(s.magnitude);
              const severity = absMag < 0.015 ? "low" : absMag < 0.04 ? "med" : "high";
              
              let color = "border-anthropic-mid/30 bg-anthropic-mid/10 text-anthropic-mid";
              if (severity === "high") color = favA ? "border-anthropic-orange/50 bg-anthropic-orange/20 text-anthropic-orange" : "border-anthropic-blue/50 bg-anthropic-blue/20 text-anthropic-blue";
              else if (severity === "med") color = favA ? "border-anthropic-orange/30 bg-anthropic-orange/10 text-anthropic-orange/90" : "border-anthropic-blue/30 bg-anthropic-blue/10 text-anthropic-blue/90";
              
              const arrow = favA ? "» A" : "B «";
              return `<span class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[10px] font-black uppercase tracking-widest ${color} shadow-sm" title="${s.source} · ${s.detail||""}">${s.label} ${arrow} <span class="opacity-70 ml-1 font-mono">${(absMag*100).toFixed(1)}%</span></span>`;
            }).join("");
          }
        }
        
        tape.classList.remove('hidden');
      }

      function applyDriveUI(cal, mode, fallbackNote) {
        const labels = { 
          user: ["My Confidence", "border-anthropic-orange/50 bg-anthropic-orange/10 text-anthropic-orange"], 
          fn: ["Fightnomics Prior", "border-anthropic-blue/50 bg-anthropic-blue/10 text-anthropic-blue"], 
          market: ["Market No-Vig", "border-anthropic-green/50 bg-anthropic-green/10 text-anthropic-green"], 
          none: ["Not determined", "border-white/10 bg-white/5 text-anthropic-mid"] 
        };
        const chip = cal.querySelector('.fn-drive-chip');
        if (chip) {
          const [label, cls] = labels[mode] || labels.none;
          chip.className = `fn-drive-chip inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] font-bold ${cls}`;
          chip.dataset.drive = mode;
          chip.innerHTML = label;
        }
        const fbEl = cal.querySelector('.fn-drive-fallback');
        if (fbEl) fbEl.textContent = fallbackNote || "";
        cal.querySelectorAll('.fn-drive-col').forEach(col => {
          const colMode = col.dataset.col;
          const badge = col.querySelector('.fn-drive-badge');
          const isActive = colMode === mode;
          if (badge) badge.classList.toggle('hidden', !isActive);
          col.classList.toggle('opacity-100', isActive);
          col.classList.toggle('opacity-40', !isActive);
          col.classList.toggle('ring-1', isActive);
          col.classList.toggle('rounded-xl', isActive);
          if (isActive) {
            if (mode === "fn") col.classList.add('ring-anthropic-blue/30', 'bg-anthropic-blue/5');
            else if (mode === "market") col.classList.add('ring-anthropic-green/30', 'bg-anthropic-green/5');
            else col.classList.add('ring-anthropic-orange/30', 'bg-anthropic-orange/5');
          } else {
            col.classList.remove('ring-anthropic-blue/30', 'bg-anthropic-blue/5', 'ring-anthropic-green/30', 'bg-anthropic-green/5', 'ring-anthropic-orange/30', 'bg-anthropic-orange/5');
          }
        });
      }

      function syntheticFightFromCard(mainCard) {
        const nameEls = mainCard.querySelectorAll('.fighter-name');
        const oddsEls = mainCard.querySelectorAll('.fighter-odds');
        const confEls = mainCard.querySelectorAll('.fighter-confidence');
        return {
          fighters: [0, 1].map(i => ({
            name: nameEls?.[i]?.value || "",
            odds: oddsEls?.[i] ? parseOddsToDecimal(oddsEls[i].value) : null,
            confidence: confEls?.[i] ? parseInt(confEls[i].value) || 50 : 50
          }))
        };
      }

      function computeDriveForCard(mainCard) {
        const mode = getProbabilityMode();
        const fight = syntheticFightFromCard(mainCard);
        const f1 = fight.fighters?.[0]; const f2 = fight.fighters?.[1];
        const cA = Math.max(0, Number(f1?.confidence) || 0);
        const cB = Math.max(0, Number(f2?.confidence) || 0);
        const userNorm = cA / Math.max(1, cA + cB);
        let hasMarket = (f1?.odds > 1) && (f2?.odds > 1) && FN;
        let hasFn = false;
        if (FN && f1?.name && f2?.name) {
          const bioA = resolveFighterBio?.(f1.name);
          const bioB = resolveFighterBio?.(f2.name);
          hasFn = !!(bioA && bioB);
        }
        let modeUsed = mode; let fallbackNote = "";
        if (mode === "market") {
          if (hasMarket) fallbackNote = "";
          else { modeUsed = "user"; fallbackNote = "⚠ Market mode active but odds not entered → fell back to My Confidence"; }
        } else if (mode === "fn") {
          if (hasFn) fallbackNote = "";
          else if (hasMarket) { modeUsed = "market"; fallbackNote = "Fight bios missing in bundle → fell back to Market No-Vig"; }
          else { modeUsed = "user"; fallbackNote = "Fight bios + odds missing → fell back to My Confidence"; }
        } else {
          modeUsed = "user";
        }
        return { modeUsed, fallbackNote, userNorm, hasMarket, hasFn };
      }

      function renderFightnomicsCalibration(mainCard, statsA, statsB, oA, oB, cA, cB) {
        // --- Creative delta: render per-fighter badges (FN vs Market) + vig%
        const badHosts = mainCard.querySelectorAll(".fighter-badge-host");
        const hvOd = oA && oB && isFinite(oA) && isFinite(oB) && oA>1 && oB>1;
        let mvPr = null, fnPr = null;
        if (hvOd && typeof FN === "object" && FN) mvPr = FN.removeVigFromOdds(oA, oB);
        if (statsA && statsB && FN) {
          try {
            const nA = FN.normalizeFighter(statsA), nB = FN.normalizeFighter(statsB);
            const ctx = hvOd ? { oddsA: oA, oddsB: oB } : {};
            fnPr = FN.fightnomicsPrior(nA, nB, ctx);
          } catch(_) { fnPr = null; }
        }
        function oneBadge(j) {
          const host = badHosts[j]; if (!host) return;
          const chips = [];
          if (mvPr) {
            const p = j === 0 ? mvPr.pA : mvPr.pB;
            chips.push(`<span class="inline-flex items-center rounded-md px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider border border-anthropic-green/30 bg-anthropic-green/10 text-anthropic-green" title="Market No-Vig probability (Broadview)">MV ${(p*100).toFixed(0)}%</span>`);
          }
          if (fnPr) {
            const p = j === 0 ? fnPr.pA : fnPr.pB;
            let delta = NaN;
            if (mvPr) {
              const mP = j === 0 ? mvPr.pA : mvPr.pB;
              delta = (p - mP) * 100; // FN − Market in pp
            }
            chips.push(`<span class="inline-flex items-center rounded-md px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider border border-anthropic-blue/30 bg-anthropic-blue/10 text-anthropic-blue" title="Fightnomics prior probability">FN ${(p*100).toFixed(0)}%</span>`);
            if (isFinite(delta) && Math.abs(delta) >= 0.5) {
              const sign = delta >= 0 ? "+" : "";
              const color = delta >= 2 ? "border-anthropic-green/40 bg-anthropic-green/10 text-anthropic-green" : delta <= -2 ? "border-anthropic-orange/40 bg-anthropic-orange/10 text-anthropic-orange" : "border-anthropic-mid/40 bg-white/5 text-anthropic-mid";
              chips.push(`<span class="inline-flex items-center rounded-md px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider border ${color}" title="FN minus Market (Δ in percentage points). + = FN favours you more than book → VALUE bet candidate.">Δ ${sign}${delta.toFixed(1)}pp</span>`);
            }
          }
          host.innerHTML = chips.length ? `<div class="flex flex-col items-end gap-1">${chips.join("")}</div>` : "";
        }
        oneBadge(0); oneBadge(1);
        // --- Standard calibration output below
        const cal = mainCard.querySelector('.fn-edge-hint');
        if (!cal) return;
        const priAEl = cal.querySelector('.fn-prior-label');
        const mktAEl = cal.querySelector('.fn-market-label');
        const usrAEl = cal.querySelector('.fn-user-label');
        const tierEl = cal.querySelector('.fn-edge-tier');
        const msgEl = cal.querySelector('.fn-edge-message');
        const calBtn = cal.querySelector('.fn-calibrate-btn');
        const blendBtn = cal.querySelector('.fn-blend-btn');
        const calBanner = cal.querySelector('.fn-calibrate-banner');
        const drive = computeDriveForCard(mainCard);
        applyDriveUI(cal, drive.modeUsed, drive.fallbackNote);
        if (!(statsA && statsB && FN)) {
          cal.classList.remove('hidden');
          priAEl.textContent = oA && oB ? "Waiting fighter bios…" : "—";
          if (oA && oB && oA>1 && oB>1 && FN) {
            const mk = FN.removeVigFromOdds(oA, oB);
            mktAEl.textContent = `${(mk.pA*100).toFixed(1)}% (vig ${(mk.vig*100).toFixed(1)}%)`;
          } else {
            mktAEl.textContent = "Enter both odds…";
          }
          usrAEl.textContent = `${((cA)/(Math.max(1,cA+cB))*100).toFixed(1)}%`;
        tierEl.className = "fn-edge-tier inline-block text-[10px] uppercase tracking-wider px-2 py-1 rounded-md font-semibold border border-anthropic-mid/30 text-anthropic-mid";
        msgEl.textContent = statsA || statsB ? "Pick the opposing fighter via autocomplete to enable calibrated Fightnomics prior." : "Pick both fighters via autocomplete to enable calibrated Fightnomics prior.";
          calBtn.disabled = true; blendBtn.disabled = true;
          return;
        }
        const hasValidOdds = oA && oB && isFinite(oA) && isFinite(oB) && oA>1 && oB>1;
        const context = hasValidOdds ? { oddsA: oA, oddsB: oB } : {};
        const nA = FN.normalizeFighter(statsA); const nB = FN.normalizeFighter(statsB);
        let prior;
        try {
          prior = FN.fightnomicsPrior(nA, nB, context);
        } catch(err) {
          cal.classList.remove('hidden');
          priAEl.textContent = "ERROR";
          mktAEl.textContent = hasValidOdds ? "computing…" : "Enter both odds";
          usrAEl.textContent = `${((cA)/(Math.max(1,cA+cB))*100).toFixed(1)}%`;
          tierEl.textContent = "ERR";
          msgEl.textContent = err.message;
          calBtn.disabled = true; blendBtn.disabled = true;
          return;
        }
        cal.classList.remove('hidden');
        const userSum = Math.max(1, cA + cB);
        const userA_norm = cA / userSum;
        priAEl.textContent = `${(prior.pA*100).toFixed(1)}% vs ${(prior.pB*100).toFixed(1)}%`;
        usrAEl.textContent = `${(userA_norm*100).toFixed(1)}% vs ${((1-userA_norm)*100).toFixed(1)}%`;
        let edge;
        if (hasValidOdds) {
          const mk = FN.removeVigFromOdds(oA, oB);
          mktAEl.textContent = `${(mk.pA*100).toFixed(1)}% (vig ${(mk.vig*100).toFixed(1)}%)`;
          edge = FN.edgeVsMarket(userA_norm, mk.pA, userA_norm, 1-userA_norm, prior.pA);
        } else {
          mktAEl.textContent = "Enter both odds…";
          edge = FN.edgeVsMarket(userA_norm, prior.pA, userA_norm, 1-userA_norm, prior.pA);
        }
        const tierClass = {
          STRONG: "text-anthropic-green bg-anthropic-green/15 border-anthropic-green/50",
          GENUINE: "text-anthropic-green/80 bg-anthropic-green/10 border-anthropic-green/30",
          WEAK: "text-anthropic-orange/80 bg-anthropic-orange/10 border-anthropic-orange/30",
          NOISY: "text-anthropic-mid bg-white/5 border-white/10"
        }[edge.tier] || "text-anthropic-mid border-white/10";
        tierEl.textContent = edge.tier;
        tierEl.className = `fn-edge-tier inline-block text-[10px] uppercase tracking-wider px-2 py-1 rounded-md font-semibold border ${tierClass}`;
        msgEl.textContent = edge.message;
        calBtn.disabled = false;
        blendBtn.disabled = false;
        if (calBanner) calBanner.classList.remove('hidden');
      }

      function applyConfidencePair(mainCard, newA_pct, newB_pct) {
        const confEls = mainCard.querySelectorAll('.fighter-confidence');
        const fillEls = mainCard.querySelectorAll('.confidence-fill');
        const valEls = mainCard.querySelectorAll('.confidence-value');
        if (confEls[0] && confEls[1]) {
          confEls[0].value = Math.max(50, Math.min(100, Math.round(newA_pct)));
          confEls[1].value = Math.max(50, Math.min(100, Math.round(newB_pct)));
          [0,1].forEach(i => {
            const v = parseInt(confEls[i].value)||50;
            if (fillEls[i]) fillEls[i].style.width = v + "%";
            if (valEls[i]) valEls[i].textContent = v + "%";
          });
          confEls[0].dispatchEvent(new Event('input'));
          confEls[1].dispatchEvent(new Event('input'));
        }
      }

      function attachCalibrationButtons(mainCard) {
        if (mainCard.dataset.calibrated) return;
        const calBtn = mainCard.querySelector('.fn-calibrate-btn');
        const blendBtn = mainCard.querySelector('.fn-blend-btn');
        if (calBtn) {
          calBtn.addEventListener('click', function() {
            playSoftClickSound?.();
            const s = getCurrentCardState(mainCard);
            if (!(s.statsA && s.statsB && FN)) return;
            const nA = FN.normalizeFighter(s.statsA); const nB = FN.normalizeFighter(s.statsB);
            let prior;
            try { prior = FN.fightnomicsPrior(nA, nB, { oddsA: s.oA, oddsB: s.oB }); } catch(_) { return; }
            let pA = prior.pA; let pB = prior.pB;
            const sum = pA + pB;
            if (sum < 0.95 || sum > 1.05) { pA = pA/sum; pB = 1 - pA; }
            applyConfidencePair(mainCard, pA*100, pB*100);
          });
        }
        if (blendBtn) {
          blendBtn.addEventListener('click', function() {
            playSoftClickSound?.();
            const s = getCurrentCardState(mainCard);
            if (!(s.statsA && s.statsB && FN)) return;
            const nA = FN.normalizeFighter(s.statsA); const nB = FN.normalizeFighter(s.statsB);
            let prior;
            try { prior = FN.fightnomicsPrior(nA, nB, { oddsA: s.oA, oddsB: s.oB }); } catch(_) { return; }
            const userSum = Math.max(1, s.cA + s.cB);
            const uA = s.cA / userSum;
            let pA = 0.40*prior.pA + 0.60*uA;
            pA = Math.max(0.50, Math.min(0.95, pA));
            const pB = 1 - pA;
            applyConfidencePair(mainCard, pA*100, pB*100);
          });
        }
        mainCard.dataset.calibrated = "1";
      }

      function attachAutocomplete(fightCard) {
        const inputs = fightCard.querySelectorAll(".fighter-name");
        inputs.forEach(inp => {
            inp.parentNode.style.position = "relative"; // Ensure dropdown positions correctly
            autocomplete(inp);
        });
      }

      function money(x) {
        return Number.isFinite(x) ? "$" + x.toFixed(2) : "-";
      }
      function dec(x) {
        return Number.isFinite(x) ? x.toFixed(2) : "-";
      }
      function pct(x) {
        return Number.isFinite(x) ? (x * 100).toFixed(2) + "%" : "-";
      }

      function logPerformance(label, startTime) {
        const duration = (performance.now() - startTime).toFixed(2);
        let memoryUsage = "";
        if (performance.memory) {
          const used = (performance.memory.usedJSHeapSize / (1024 * 1024)).toFixed(2);
          const limit = (performance.memory.jsHeapSizeLimit / (1024 * 1024)).toFixed(2);
          memoryUsage = ` | Memory: ${used}MB / ${limit}MB`;
        }
        console.log(`%c[PERF]%c ${label} took %c${duration}ms%c${memoryUsage}`, 
          "color: #d97757; font-weight: bold;", "color: inherit;", 
          "color: #788c5d; font-weight: bold;", "color: #b0aea5;");
        
        // Add performance mark for Chrome DevTools
        performance.mark(`${label}-end`);
        performance.measure(label, { start: startTime, end: performance.now() });
      }

      function initCustomCursor() {
        const cursor = document.getElementById('custom-cursor');
        const ring = document.getElementById('custom-cursor-ring');
        if (!cursor || !ring) return;

        let mouseX = 0, mouseY = 0;
        let ringX = 0, ringY = 0;

        document.addEventListener('mousemove', (e) => {
          mouseX = e.clientX;
          mouseY = e.clientY;
          cursor.style.left = `${mouseX}px`;
          cursor.style.top = `${mouseY}px`;
          
          // Hover effects
          const target = e.target;
          const isInteractive = target.closest('button, a, input, [role="button"], .nav-pill, .autocomplete-item');
          if (isInteractive) {
            cursor.style.transform = 'translate(-50%, -50%) scale(2)';
            cursor.style.background = 'var(--anthropic-light)';
            ring.style.transform = 'translate(-50%, -50%) scale(1.5)';
            ring.style.borderColor = 'var(--anthropic-light)';
            ring.style.opacity = '0.6';
          } else {
            cursor.style.transform = 'translate(-50%, -50%) scale(1)';
            cursor.style.background = 'var(--anthropic-orange)';
            ring.style.transform = 'translate(-50%, -50%) scale(1)';
            ring.style.borderColor = 'var(--anthropic-orange)';
            ring.style.opacity = '0.3';
          }
        });

        // Smooth ring follow
        function animateRing() {
          ringX += (mouseX - ringX) * 0.15;
          ringY += (mouseY - ringY) * 0.15;
          ring.style.left = `${ringX}px`;
          ring.style.top = `${ringY}px`;
          requestAnimationFrame(animateRing);
        }
        animateRing();
      }

      function getScaledRows(rows, allocPct) {
        const f = Math.max(0, allocPct) / 100;
        return rows.map((r) => ({
          ...r,
          stake: Math.max(0, r.stake * f),
        }));
      }
      function clampOdds(x) {
        if (!Number.isFinite(x)) return NaN;
        return Math.max(1.01, x);
      }
      function clampConfidence(x) {
        if (!Number.isFinite(x)) return NaN;
        return Math.min(100, Math.max(50, x));
      }
      function clampBankroll(x) {
        if (!Number.isFinite(x)) return NaN;
        return Math.max(0, x);
      }
      function initBackgroundParticles() {
        const canvas = document.getElementById('bgParticles');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        let w, h, particles = [];
        
        const resize = () => {
          w = canvas.width = window.innerWidth;
          h = canvas.height = window.innerHeight;
        };
        
        window.addEventListener('resize', resize);
        resize();
        
        class Particle {
          constructor() {
            this.x = Math.random() * w;
            this.y = Math.random() * h;
            this.size = Math.random() * 1.5 + 0.5;
            this.speedX = Math.random() * 0.5 - 0.25;
            this.speedY = Math.random() * 0.5 - 0.25;
            this.opacity = Math.random() * 0.5 + 0.1;
          }
          update() {
            this.x += this.speedX;
            this.y += this.speedY;
            if (this.x > w) this.x = 0;
            if (this.x < 0) this.x = w;
            if (this.y > h) this.y = 0;
            if (this.y < 0) this.y = h;
          }
          draw() {
            ctx.fillStyle = `rgba(176, 174, 165, ${this.opacity})`; // Anthropic Mid
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        
        for (let i = 0; i < 60; i++) {
          particles.push(new Particle());
        }
        
        function animate() {
          ctx.clearRect(0, 0, w, h);
          particles.forEach(p => {
            p.update();
            p.draw();
          });
          requestAnimationFrame(animate);
        }
        animate();
      }

      function initTilt(selector) {
        const els = document.querySelectorAll(selector);
        els.forEach((el) => {
          el.style.transformStyle = "preserve-3d";
          el.addEventListener("mousemove", (e) => {
            const rect = el.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const cx = rect.width / 2;
            const cy = rect.height / 2;
            const rx = (y - cy) / 20;
            const ry = (cx - x) / 20;
            el.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg)`;
          });
          el.addEventListener("mouseleave", () => {
            el.style.transform = "rotateX(0) rotateY(0)";
          });
        });
      }
      // Confetti & Chart utils
      function drawSparkline(canvas, data) {
        if (!canvas || !data || data.length === 0) return;
        
        canvas._renderFn = () => {
          if (activeCharts.has(canvas)) activeCharts.get(canvas).destroy();
          const ctx = canvas.getContext("2d");
          const chart = new Chart(ctx, {
            type: 'line',
            data: {
              labels: data.map((_, i) => i),
              datasets: [{
                data: data,
                fill: true,
                borderColor: '#d97757',
                backgroundColor: 'rgba(217, 119, 87, 0.1)',
                borderWidth: 2,
                tension: 0.4,
                pointRadius: 0
              }]
            },
            options: {
              responsive: true,
              maintainAspectRatio: true,
              aspectRatio: 3.66,
              scales: { x: { display: false }, y: { display: false } },
              plugins: { legend: { display: false }, tooltip: { enabled: false } }
            }
          });
          activeCharts.set(canvas, chart);
        };

        chartObserver.observe(canvas);
      }
      function drawBars(canvas, metrics) {
        if (!canvas || !metrics) return;
        
        canvas._renderFn = () => {
          if (activeCharts.has(canvas)) activeCharts.get(canvas).destroy();
          const ctx = canvas.getContext("2d");
          const chart = new Chart(ctx, {
            type: 'bar',
            data: {
              labels: ['EV', 'Vol', 'Exp'],
              datasets: [{
                data: [metrics.ev / 10, metrics.stdDev / 10, metrics.exposurePct * 100],
                backgroundColor: ['#788c5d', '#b0aea5', '#6a9bcc'],
                borderRadius: 4
              }]
            },
            options: {
              responsive: true,
              maintainAspectRatio: true,
              aspectRatio: 3.63,
              scales: {
                x: { display: true, grid: { display: false }, ticks: { color: '#b0aea5', font: { size: 8 } } },
                y: { display: false }
              },
              plugins: { legend: { display: false }, tooltip: { enabled: true } }
            }
          });
          activeCharts.set(canvas, chart);
        };

        chartObserver.observe(canvas);
      }
      function drawHistogram(canvas, results, bankroll) {
        if (!canvas || !results || results.length === 0) return;
        drawMonteCarloDistribution(canvas, results, bankroll);
      }
      function buildWarnings(m) {
        const w = [];
        if (m.lossProb > 0.6) w.push({ text: "High Loss Prob", cls: "text-red-400 border-red-500/30" });
        if (m.exposurePct > 0.4) w.push({ text: "Overexposed", cls: "text-orange-400 border-orange-500/30" });
        if (m.volLevel === "High") w.push({ text: "High Volatility", cls: "text-yellow-400 border-yellow-500/30" });
        if (m.ev < 0) w.push({ text: "Negative EV", cls: "text-red-500 border-red-600/30" });
        return w;
      }
      function slugifyName(name) {
        return name.toLowerCase().replace(/\s+/g, '-').replace(/[^\w\-]+/g, '');
      }
      
      // ... Main Logic (readFights, buildFights, calculate) ...
      
      function buildFights() {
        const count = Math.max(1, Math.min(5, parseInt(fightCountEl.value) || 1));
        fightCountEl.value = count;
        if (isNaN(count) || count < 1) return;
        fightsContainer.innerHTML = "";
        for (let i = 0; i < count; i++) {
          const div = document.createElement("div");
          // Use flex-col on mobile, flex-row on lg screens for side-by-side
          // Actually, stick to vertical stack for rows, but inside row use grid
          div.className = "fight-card rounded-2xl w-full p-1 opacity-0 animate-slide-in relative border border-white/10 overflow-hidden";
          div.style.animationDelay = `${i * 100}ms`;
          div.dataset.fightIndex = String(i);
          
          div.innerHTML = `
            <div class="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-anthropic-orange to-transparent opacity-50"></div>
            <div class="p-5 grid grid-cols-1 lg:grid-cols-2 gap-8 relative">
            
            <!-- VS Badge -->
            <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-full bg-anthropic-dark border border-white/10 z-10 shadow-xl pointer-events-none">
              <span class="text-[10px] font-bold text-anthropic-mid">VS</span>
            </div>

            <div class="rounded-xl border border-white/10 bg-white/5 fight-card">
              <div class="p-6 space-y-3">
                <div>
                  <label class="block text-xs mb-1 text-anthropic-mid font-heading font-semibold uppercase tracking-wider">Fighter A Name</label>
                  <input type="text" class="fighter-name w-full rounded-lg bg-black/20 border border-white/10 px-3 py-2 outline-none focus:ring-2 focus:ring-anthropic-orange/50 input-glow font-mono text-sm" placeholder="Fighter A" />
                  <p class="error-name mt-1 text-xs text-anthropic-orange hidden"></p>
                </div>
                <div class="grid grid-cols-1 xl:grid-cols-2 gap-3">
                  <div>
                    <label class="block text-xs mb-1 text-anthropic-mid font-heading font-semibold uppercase tracking-wider odds-label">${oddsFormatAmerican ? "American Odds" : "Decimal Odds"}</label>
                    <input type="text" class="fighter-odds w-full rounded-lg bg-black/20 border border-white/10 px-3 py-2 outline-none focus:ring-2 focus:ring-anthropic-orange/50 input-glow font-mono text-sm" placeholder="${oddsFormatAmerican ? "-110" : "1.90"}" inputmode="decimal" />
                    <p class="error-odds mt-1 text-xs text-anthropic-orange hidden"></p>
                    <p class="mt-1 text-[11px] text-anthropic-mid font-mono fighter-meta">Implied: —</p>
                  </div>
                  <div>
                    <label class="block text-xs mb-1 text-anthropic-mid font-heading font-semibold uppercase tracking-wider">Status</label>
                    <select class="fighter-status w-full rounded-lg bg-black/20 border border-white/10 px-3 py-2 outline-none focus:ring-2 focus:ring-anthropic-orange/50 input-glow text-sm">
                      <option value="neutral">Neutral</option>
                      <option value="lock">🔒 LOCK</option>
                      <option value="fade">⚠️ FADE</option>
                    </select>
                  </div>
                </div>
              <div>
                <label class="block text-xs mb-2 text-anthropic-mid flex justify-between font-heading font-semibold uppercase tracking-wider">
                  <span>Confidence</span>
                  <span class="confidence-value font-mono text-anthropic-light">50%</span>
                </label>
                <div class="relative h-2 bg-black/40 rounded-full mb-1 overflow-hidden">
                   <div class="absolute top-0 left-0 h-full bg-white/5 w-full"></div>
                   <div class="implied-marker absolute top-0 bottom-0 w-0.5 bg-anthropic-light z-10 hidden" title="Implied Probability"></div>
                   <div class="confidence-fill absolute top-0 left-0 h-full bg-anthropic-orange transition-all duration-300" style="width: 50%"></div>
                </div>
                <input type="range" min="50" max="100" value="50" class="fighter-confidence w-full accent-anthropic-orange opacity-0 absolute inset-0 cursor-pointer z-20 h-6 -mt-4" />
                <div class="flex justify-between text-[10px] text-anthropic-mid font-mono mt-1">
                  <span>50%</span>
                  <span class="edge-display text-anthropic-subtle">0% Edge</span>
                  <span>100%</span>
                </div>
                <p class="error-confidence mt-1 text-xs text-anthropic-orange hidden"></p>
              </div>
              </div>
            </div>

            <div class="rounded-xl border border-white/10 bg-white/5 fight-card">
              <div class="p-6 space-y-3">
                <div>
                  <label class="block text-xs mb-1 text-anthropic-mid font-heading font-semibold uppercase tracking-wider">Fighter B Name</label>
                  <input type="text" class="fighter-name w-full rounded-lg bg-black/20 border border-white/10 px-3 py-2 outline-none focus:ring-2 focus:ring-anthropic-blue/50 input-glow font-mono text-sm" placeholder="Fighter B" />
                  <p class="error-name mt-1 text-xs text-anthropic-orange hidden"></p>
                </div>
                <div class="grid grid-cols-1 xl:grid-cols-2 gap-3">
                  <div>
                    <label class="block text-xs mb-1 text-anthropic-mid font-heading font-semibold uppercase tracking-wider odds-label">${oddsFormatAmerican ? "American Odds" : "Decimal Odds"}</label>
                    <input type="text" class="fighter-odds w-full rounded-lg bg-black/20 border border-white/10 px-3 py-2 outline-none focus:ring-2 focus:ring-anthropic-blue/50 input-glow font-mono text-sm" placeholder="${oddsFormatAmerican ? "+110" : "2.10"}" inputmode="decimal" />
                    <p class="error-odds mt-1 text-xs text-anthropic-orange hidden"></p>
                    <p class="mt-1 text-[11px] text-anthropic-mid font-mono fighter-meta">Implied: —</p>
                  </div>
                  <div>
                    <label class="block text-xs mb-1 text-anthropic-mid font-heading font-semibold uppercase tracking-wider">Status</label>
                    <select class="fighter-status w-full rounded-lg bg-black/20 border border-white/10 px-3 py-2 outline-none focus:ring-2 focus:ring-anthropic-blue/50 input-glow text-sm">
                      <option value="neutral">Neutral</option>
                      <option value="lock">🔒 LOCK</option>
                      <option value="fade">⚠️ FADE</option>
                    </select>
                  </div>
                </div>
              <div>
                <label class="block text-xs mb-2 text-anthropic-mid flex justify-between font-heading font-semibold uppercase tracking-wider">
                  <span>Confidence</span>
                  <span class="confidence-value font-mono text-anthropic-light">75%</span>
                </label>
                <div class="relative h-2 bg-black/40 rounded-full mb-1 overflow-hidden">
                   <div class="absolute top-0 left-0 h-full bg-white/5 w-full"></div>
                   <div class="implied-marker absolute top-0 bottom-0 w-0.5 bg-anthropic-light z-10 hidden" title="Implied Probability"></div>
                   <div class="confidence-fill absolute top-0 left-0 h-full bg-anthropic-blue transition-all duration-300" style="width: 75%"></div>
                </div>
                <input type="range" min="50" max="100" value="75" class="fighter-confidence w-full accent-anthropic-blue opacity-0 absolute inset-0 cursor-pointer z-20 h-6 -mt-4" />
                <div class="flex justify-between text-[10px] text-anthropic-mid font-mono mt-1">
                  <span>50%</span>
                  <span class="edge-display text-anthropic-subtle">0% Edge</span>
                  <span>100%</span>
                </div>
                <p class="error-confidence mt-1 text-xs text-anthropic-orange hidden"></p>
              </div>
              </div>
            </div>
          </div>
          
          <!-- Fightnomics Confidence Calibration -->
          <div class="fn-edge-hint mt-6 rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md p-4 text-xs hidden shadow-glow">
            <div class="fn-drive-chip-wrap flex flex-wrap items-center gap-3 mb-4 pb-3 border-b border-white/10">
              <span class="text-[10px] uppercase tracking-widest text-anthropic-mid font-bold">Strategy Probability Drive</span>
              <span class="fn-drive-chip inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/10 bg-white/5 text-anthropic-mid text-[11px] font-bold" data-drive="none">
                ⏸ Not determined
              </span>
              <span class="fn-drive-fallback text-[10px] text-anthropic-mid italic leading-tight opacity-70"></span>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-start">
              <div class="fn-drive-col p-3 rounded-xl border border-white/5 bg-white/0 transition-all" data-col="fn">
                <div class="flex items-center justify-between mb-2">
                  <span class="text-[10px] uppercase tracking-widest text-anthropic-mid font-bold">FN Prior</span>
                  <span class="fn-drive-badge hidden text-[8px] uppercase font-black tracking-widest px-1.5 py-0.5 rounded-full bg-anthropic-blue/20 text-anthropic-blue border border-anthropic-blue/30">Active</span>
                </div>
                <span class="fn-prior-label font-mono text-lg text-anthropic-light">—</span>
              </div>
              <div class="fn-drive-col p-3 rounded-xl border border-white/5 bg-white/0 transition-all" data-col="market">
                <div class="flex items-center justify-between mb-2">
                  <span class="text-[10px] uppercase tracking-widest text-anthropic-mid font-bold">Market</span>
                  <span class="fn-drive-badge hidden text-[8px] uppercase font-black tracking-widest px-1.5 py-0.5 rounded-full bg-anthropic-green/20 text-anthropic-green border border-anthropic-green/30">Active</span>
                </div>
                <span class="fn-market-label font-mono text-lg text-anthropic-light">—</span>
              </div>
              <div class="fn-drive-col p-3 rounded-xl border border-white/5 bg-white/0 transition-all" data-col="user">
                <div class="flex items-center justify-between mb-2">
                  <span class="text-[10px] uppercase tracking-widest text-anthropic-mid font-bold">Estimate</span>
                  <span class="fn-drive-badge hidden text-[8px] uppercase font-black tracking-widest px-1.5 py-0.5 rounded-full bg-anthropic-orange/20 text-anthropic-orange border border-anthropic-orange/30">Active</span>
                </div>
                <span class="fn-user-label font-mono text-lg text-anthropic-light">—</span>
              </div>
              <div class="space-y-3">
                <span class="fn-edge-tier inline-block text-[10px] uppercase tracking-widest px-3 py-1 rounded-full font-black border border-white/10 text-anthropic-mid bg-white/5">No Data</span>
                <div class="flex flex-col gap-2">
                  <button type="button" class="fn-calibrate-btn w-full inline-flex items-center justify-center gap-2 rounded-lg border border-anthropic-blue/30 bg-anthropic-blue/10 text-anthropic-blue hover:bg-anthropic-blue/20 px-4 py-2 text-xs font-bold uppercase tracking-wider transition-all disabled:opacity-30" disabled>
                    Calibrate Stats
                  </button>
                  <button type="button" class="fn-blend-btn w-full inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 text-anthropic-mid hover:bg-white/10 px-4 py-2 text-[10px] font-bold uppercase tracking-wider transition-all disabled:opacity-30" disabled>
                    Blend 40/60
                  </button>
                </div>
              </div>
            </div>
            <p class="fn-edge-message text-[10px] text-anthropic-mid mt-4 leading-relaxed opacity-60 border-t border-white/5 pt-3">Pick both fighters via autocomplete to enable calibrated Fightnomics prior.</p>
          </div>

          <!-- Tale of the Tape Visualization -->
          <div class="tale-of-the-tape hidden mt-6 pt-6 border-t border-white/10">
             <div class="flex items-center justify-between mb-6">
                <h4 class="text-sm font-heading font-black uppercase tracking-widest text-anthropic-light">Advanced Metrics Comparison</h4>
                <div class="fn-fuzzy-pill"></div>
             </div>
             
             <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
               <!-- Physicals Column -->
               <div class="lg:col-span-3 rounded-2xl border border-white/10 bg-white/5 p-4 space-y-4 shadow-inner">
                 <div class="text-[10px] uppercase tracking-widest text-anthropic-mid font-bold mb-2">Physical Specs</div>
                 ${["Reach", "Height", "Win Rate"].map(label => {
                   const key = label.toLowerCase().replace(" ", "-");
                   return `
                    <div class="tape-row space-y-1.5">
                      <div class="flex justify-between text-[10px] font-bold text-anthropic-mid uppercase tracking-wider">
                        <span class="val-a-${key}">—</span>
                        <span>${label}</span>
                        <span class="val-b-${key}">—</span>
                      </div>
                      <div class="h-1.5 w-full flex bg-black/40 rounded-full overflow-hidden relative">
                        <div class="bar-a h-full bg-anthropic-orange transition-all duration-700 ease-out" style="width: 0%"></div>
                        <div class="w-px h-full bg-white/20 absolute left-1/2 z-10"></div>
                        <div class="bar-b h-full bg-anthropic-blue transition-all duration-700 ease-out" style="width: 0%"></div>
                      </div>
                    </div>
                   `;
                 }).join("")}
                 <div class="tape-row pt-2 flex justify-between items-center border-t border-white/5 mt-2">
                    <span class="val-a-age font-mono text-xs text-anthropic-light">—</span>
                    <span class="text-[10px] uppercase tracking-widest text-anthropic-mid font-bold">Age</span>
                    <span class="val-b-age font-mono text-xs text-anthropic-light">—</span>
                 </div>
               </div>

               <!-- Radar Chart Column -->
               <div class="lg:col-span-5 rounded-2xl border border-white/10 bg-white/5 p-4 relative min-h-[300px] flex flex-col shadow-inner">
                  <div class="text-[10px] uppercase tracking-widest text-anthropic-mid font-bold mb-4">Performance Signature</div>
                  <div class="flex-1 relative">
                    <canvas class="radar-chart-canvas"></canvas>
                  </div>
               </div>

               <!-- Signals & Prior Column -->
               <div class="lg:col-span-4 space-y-4">
                 <div class="rounded-2xl border border-white/10 bg-white/5 p-4 shadow-inner min-h-[140px]">
                    <div class="flex items-center justify-between mb-3">
                      <div class="text-[10px] uppercase tracking-widest text-anthropic-mid font-bold">Strategic Signals</div>
                      <div class="fn-stats-fill text-[9px] text-anthropic-mid opacity-50 font-mono"></div>
                    </div>
                    <div class="fn-signal-chips flex flex-wrap gap-2">
                      <span class="text-[10px] text-anthropic-mid italic opacity-60">Awaiting matchup data…</span>
                    </div>
                    <div class="fn-missing-chip text-[9px] text-anthropic-orange mt-2 italic hidden"></div>
                 </div>

                 <div class="rounded-2xl border border-anthropic-blue/20 bg-anthropic-blue/5 p-4 shadow-glow">
                    <div class="text-[10px] uppercase tracking-widest text-anthropic-blue font-black mb-3">Calibrated Base Rate</div>
                    <div class="space-y-3">
                      <div class="flex items-center gap-3">
                        <span class="fn-prior-a flex-1 text-center py-2 rounded-lg font-mono text-lg font-black bg-anthropic-orange/20 text-anthropic-orange border border-anthropic-orange/30">—</span>
                        <div class="w-12 h-px bg-white/10"></div>
                        <span class="fn-prior-b flex-1 text-center py-2 rounded-lg font-mono text-lg font-black bg-anthropic-blue/20 text-anthropic-blue border border-anthropic-blue/30">—</span>
                      </div>
                      <div class="relative h-2 bg-black/40 rounded-full overflow-hidden">
                        <div class="fn-prior-knob h-full bg-gradient-to-r from-anthropic-orange via-white/10 to-anthropic-blue transition-all duration-1000" style="width: 50%"></div>
                        <div class="w-px h-full bg-white/40 absolute left-1/2 z-10"></div>
                      </div>
                      <div class="fn-prior-caption text-[9px] text-anthropic-mid leading-relaxed opacity-80 italic"></div>
                    </div>
                 </div>
               </div>
             </div>
          </div>
          `;

          fightsContainer.appendChild(div);
          
          attachAutocomplete(div);
          
          // Wire up event listeners for this specific card
          const nameInputs = div.querySelectorAll(".fighter-name");
          nameInputs.forEach(inp => {
            inp.addEventListener("input", () => {
              if (inp.value.trim() === "") delete inp.dataset.fighterStats;
              refreshCalibrationLive();
            });
            inp.addEventListener("blur", () => refreshCalibrationLive());
          });

          const oddsInputs = div.querySelectorAll(".fighter-odds");
          const confInputs = div.querySelectorAll(".fighter-confidence");
          const metas = div.querySelectorAll(".fighter-meta");
          const confFills = div.querySelectorAll(".confidence-fill");
          const confVals = div.querySelectorAll(".confidence-value");
          const edgeDisplays = div.querySelectorAll(".edge-display");
          const impliedMarkers = div.querySelectorAll(".implied-marker");
          
          // Insert confidence-sum warning above the Tale of the Tape section
          const confWarn = document.createElement("div");
          confWarn.className = "confidence-warning hidden mt-4 mb-2 text-xs p-2 rounded-md border border-yellow-500/30 bg-yellow-500/10 text-yellow-300 font-medium";
          const tapeSection = div.querySelector(".tale-of-the-tape");
          if (tapeSection) {
            div.querySelector(".p-5.grid").appendChild(confWarn);
          } else {
            const innerGrid = div.querySelector(".p-5.grid");
            if (innerGrid) innerGrid.appendChild(confWarn);
          }
          
          const updateConfidenceSum = () => {
              const cA = parseInt(confInputs[0]?.value) || 0;
              const cB = parseInt(confInputs[1]?.value) || 0;
              const total = cA + cB;
              if (confWarn) {
                  if (total < 95 || total > 105) {
                      const diff = total - 100;
                      const sign = diff > 0 ? "+" : "";
                      confWarn.textContent = `⚠ Confidence sums to ${total}% (${sign}${diff}%). Kelly math assumes complementary probabilities (~100%).`;
                      confWarn.classList.remove("hidden");
                  } else {
                      confWarn.classList.add("hidden");
                  }
              }
          };

          let debounceTimer;
          const refreshCalibrationLive = () => {
              clearTimeout(debounceTimer);
              debounceTimer = setTimeout(() => {
                const s = getCurrentCardState(div);
                if (s.statsA || s.statsB) {
                  if (s.statsA && s.statsB && typeof renderTaleOfTheTape === "function") {
                    renderTaleOfTheTape(div, s.statsA, s.statsB, s.oA, s.oB);
                  } else if (typeof renderPartialStatsOnly === "function") {
                    renderPartialStatsOnly(div, s.statsA, s.statsB, s.oA, s.oB);
                  }
                }
                if (typeof renderFightnomicsCalibration === "function") {
                  renderFightnomicsCalibration(div, s.statsA, s.statsB, s.oA, s.oB, s.cA, s.cB);
                }
                if (typeof attachCalibrationButtons === "function") attachCalibrationButtons(div);
              }, 120);
          };
          
          const updateEdge = (idx) => {
              const rawVal = oddsInputs[idx].value;
              const odds = parseOddsToDecimal(rawVal);
              const conf = parseInt(confInputs[idx].value);
              const meta = metas[idx];
              const fill = confFills[idx];
              const valDisplay = confVals[idx];
              const edgeDisplay = edgeDisplays[idx];
              const marker = impliedMarkers[idx];
              
              valDisplay.textContent = conf + "%";
              fill.style.width = conf + "%";
              
              // Dynamic Color based on Confidence
              if (conf >= 80) fill.className = "confidence-fill absolute top-0 left-0 h-full transition-all duration-300 bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]";
              else if (conf >= 60) fill.className = "confidence-fill absolute top-0 left-0 h-full transition-all duration-300 bg-yellow-500 shadow-[0_0_10px_rgba(234,179,8,0.5)]";
              else fill.className = "confidence-fill absolute top-0 left-0 h-full transition-all duration-300 bg-slate-500";
              
              if (Number.isFinite(odds) && odds > 1) {
                  const implied = (1 / odds) * 100;
                  meta.textContent = `Implied: ${implied.toFixed(1)}%`;
                  marker.style.left = implied + "%";
                  marker.classList.remove("hidden");
                  
                  // Calculate Edge: (Conf - Implied)
                  const edge = conf - implied;
                  const edgeText = `${edge > 0 ? "+" : ""}${edge.toFixed(1)}% Edge`;
                  edgeDisplay.textContent = edgeText;
                  
                  if (edge > 5) edgeDisplay.className = "edge-display text-[10px] text-green-400 font-bold animate-pulse";
                  else if (edge < -5) edgeDisplay.className = "edge-display text-[10px] text-red-400";
                  else edgeDisplay.className = "edge-display text-[10px] text-slate-400";
                  
              } else {
                  meta.textContent = "Implied: —";
                  marker.classList.add("hidden");
                  edgeDisplay.textContent = "0% Edge";
                  edgeDisplay.className = "edge-display text-slate-400";
              }
              
              updateConfidenceSum();
              refreshCalibrationLive();
          };
          
          oddsInputs.forEach((inp, idx) => {
              inp.addEventListener("input", () => updateEdge(idx));
              inp.addEventListener("blur", () => {
                  const dec = parseOddsToDecimal(inp.value);
                  if (Number.isFinite(dec) && dec > 1) {
                      inp.value = formatOddsDisplay(dec);
                  }
                  refreshCalibrationLive();
              });
          });
          confInputs.forEach((inp, idx) => inp.addEventListener("input", () => updateEdge(idx)));
          setTimeout(() => { updateConfidenceSum(); refreshCalibrationLive(); attachCalibrationButtons?.(div); }, 0);
        }
        calcBtn.disabled = false;
        calcBtn.classList.remove("cursor-not-allowed", "bg-white/10");
        calcBtn.classList.add("bg-red-600", "hover:bg-red-500");
        calcBtn.textContent = "Calculate Strategies";
      }
      
      function readFights() {
        const rows = document.querySelectorAll(".fight-card .grid"); // .fight-card is the row wrapper now
        const fights = [];
        // We iterate through the container children which are the row wrappers
        const wrappers = fightsContainer.children;
        for (let i = 0; i < wrappers.length; i++) {
            const wrap = wrappers[i];
            const cards = wrap.querySelectorAll('.rounded-xl.border.bg-white\\/5'); // inner cards
            if (cards.length < 2) continue;
            
            const getFighterData = (card) => {
                return {
                    name: card.querySelector(".fighter-name").value.trim(),
                    odds: parseOddsToDecimal(card.querySelector(".fighter-odds").value),
                    confidence: parseInt(card.querySelector(".fighter-confidence").value),
                    status: card.querySelector(".fighter-status").value
                };
            };
            
            const f1 = getFighterData(cards[0]);
            const f2 = getFighterData(cards[1]);
            
            fights.push({
                id: i + 1,
                fighters: [f1, f2]
            });
        }
        return fights;
      }
      function generateParlays(fights) {
        // We only pick ONE side per fight or SKIP.
        // A parlay is a combination of picks from N fights.
        // For N=3, we have 3 fights. We can pick A, B, or Skip.
        // Actually, for "parlay" generation in this context, we usually mean:
        // iterate all combinations of outcome A or B. 2^N combinations.
        // We filter out "bad" EV picks later? No, we generate all valid combos of picks.
        const combinations = [];
        const n = fights.length;
        // Fight count capped at 5 (2^5 = 32 full parlays) to prevent browser freeze.
        // Additional EV-based truncation is applied if needed after generation.
        const maxN = 5;
        if (n > maxN) {
          console.warn(`generateParlays: ${n} fights exceeds cap of ${maxN}, truncating.`);
        }
        // Let's implement a recursive generator that picks A or B.
        
        function recurse(idx, currentParlay) {
            if (idx === n) {
                if (currentParlay.length > 0) combinations.push(currentParlay);
                return;
            }
            const f = fights[idx];
            const [a, b] = f.fighters;
            
            // Option 1: Pick A (if valid)
            if (!isNaN(a.odds) && !isNaN(a.confidence)) {
                recurse(idx + 1, [...currentParlay, { fight: f.id, name: a.name, odds: a.odds, prob: a.confidence / 100, status: a.status }]);
            }
            // Option 2: Pick B (if valid)
            if (!isNaN(b.odds) && !isNaN(b.confidence)) {
                recurse(idx + 1, [...currentParlay, { fight: f.id, name: b.name, odds: b.odds, prob: b.confidence / 100, status: b.status }]);
            }
            // Option 3: Skip this fight (allow smaller parlays? usually we want full parlays or singles)
            // For this app, let's assume we want to parlay ALL selected fights. 
            // OR allow subsets? Complexity explodes with subsets. 3^N.
            // Let's stick to: A parlay must include a pick from EVERY fight configured?
            // No, usually you bet on a subset.
            // Let's stick to "All combinations of outcomes" for the configured fights.
            // i.e. 2^N outcomes.
        }
        // Actually, simply generating 2^N outcomes creates "Full Parlays".
        recurse(0, []);
        
        // Calculate combined stats
        return combinations.map(picks => {
            const combinedOdds = picks.reduce((acc, p) => acc * p.odds, 1);
            const combinedProb = picks.reduce((acc, p) => acc * p.prob, 1);
            return { picks, combinedOdds, combinedProb };
        }).filter(p => p.combinedProb > 0);
      }
      
      function computeSinglesRows(fights, bankroll) {
        const bets = [];
        fights.forEach((fight, i) => {
          const [a, b] = computeFightProbabilities(fight);
          const ka = kellyFraction(a.odds, a.prob);
          const kb = kellyFraction(b.odds, b.prob);
          if (ka > 0) bets.push({ fight: i + 1, name: a.name, odds: a.odds, prob: a.prob, fraction: ka, status: a.status });
          if (kb > 0) bets.push({ fight: i + 1, name: b.name, odds: b.odds, prob: b.prob, fraction: kb, status: b.status });
        });
        const rows = bets.map((b) => ({ picks: [{ fight: b.fight, name: b.name, status: b.status, odds: b.odds, prob: b.prob }], combinedOdds: b.odds, combinedProb: b.prob, stake: bankroll * b.fraction }));
        const totalStake = rows.reduce((s, r) => s + r.stake, 0);
        if (totalStake > bankroll && totalStake > 0) {
          const scale = bankroll / totalStake;
          rows.forEach((r) => (r.stake = r.stake * scale));
        }
        return rows;
      }
      
      function computeFightMarket(fight) {
        if (!window.FN || !fight) return null;
        const fA = fight.fighters[0];
        const fB = fight.fighters[1];
        if (!(fA && fA.odds > 1 && fB && fB.odds > 1)) return null;
        return window.FN.removeVigFromOdds(fA.odds, fB.odds);
      }
      function getProbabilityMode() {
        const el = document.querySelector('input[name="probMode"]:checked');
        const val = el ? el.value : "user";
        if (["user","fn","market"].indexOf(val) >= 0) return val;
        return "user";
      }

      function computeFightnomicsProbForFight(fight) {
        if (!window.FN) return null;
        const fA = fight.fighters?.[0];
        const fB = fight.fighters?.[1];
        if (!fA || !fB || !fA.name || !fB.name) return null;
        const bioA = resolveFighterBio?.(fA.name) || null;
        const bioB = resolveFighterBio?.(fB.name) || null;
        if (!bioA || !bioB) return null;
        const ctx = { oddsA: (fA.odds && isFinite(fA.odds) && fA.odds>1) ? fA.odds : null, oddsB: (fB.odds && isFinite(fB.odds) && fB.odds>1) ? fB.odds : null };
        try {
          const prior = window.FN.fightnomicsPrior(window.FN.normalizeFighter(bioA), window.FN.normalizeFighter(bioB), ctx);
          return { pA: prior.pA, pB: prior.pB, prior };
        } catch(_) { return null; }
      }

      function computeFightProbabilities(fight) {
          const mode = getProbabilityMode();
          const f1 = fight.fighters[0];
          const f2 = fight.fighters[1];
          const cA = Math.max(0, Number(f1.confidence) || 0);
          const cB = Math.max(0, Number(f2.confidence) || 0);
          const userNormA = cA / Math.max(1, cA + cB);
          const userNormB = 1 - userNormA;
          const market = computeFightMarket(fight);
          let modeUsed = mode;
          let fallbackNote = "";
          let probA, probB;
          if (mode === "market") {
            if (market) { probA = market.pA; probB = market.pB; }
            else { probA = userNormA; probB = userNormB; modeUsed = "user"; fallbackNote = "Market odds missing → fell back to My Confidence"; }
          } else if (mode === "fn") {
            const pr = computeFightnomicsProbForFight(fight);
            if (pr) { probA = pr.pA; probB = pr.pB; }
            else if (market) { probA = market.pA; probB = market.pB; modeUsed = "market"; fallbackNote = "Fight bios not in bundle → fell back to Market No-Vig"; }
            else { probA = userNormA; probB = userNormB; modeUsed = "user"; fallbackNote = "Fight bios + odds missing → fell back to My Confidence"; }
          } else {
            probA = userNormA; probB = userNormB;
          }
          const sumCheck = probA + probB;
          if (sumCheck < 0.95 || sumCheck > 1.05) {
            const s = probA + probB;
            probA = probA / s; probB = 1 - probA;
          }
          return [
              { name: f1.name, odds: f1.odds, prob: probA, status: f1.status,
                market: market ? market.pA : null, vig: market ? market.vig : null,
                userProb: userNormA,
                modeUsed, fallbackNote },
              { name: f2.name, odds: f2.odds, prob: probB, status: f2.status,
                market: market ? market.pB : null, vig: market ? market.vig : null,
                userProb: userNormB,
                modeUsed, fallbackNote }
          ];
      }

      function truncateParlaysByKelly(parlays, bankroll, limit) {
          // Sort by Kelly Fraction/Impact
          // We calculate raw kelly fraction for each parlay
          const withK = parlays.map(p => {
              const k = kellyFraction(p.combinedOdds, p.combinedProb);
              return { ...p, rawKelly: k };
          });
          // Filter positive Kelly only? No, maybe equal stake wants them.
          // Sort by "Edge" or "EV"?
          // EV = (Prob * Odds) - 1
          withK.sort((a, b) => {
              const evA = a.combinedProb * a.combinedOdds;
              const evB = b.combinedProb * b.combinedOdds;
              return evB - evA;
          });
          
          if (withK.length <= limit) return { rows: withK, warn: "" };
          
          // Cut off
          return { 
              rows: withK.slice(0, limit), 
              warn: `Analysis truncated to top ${limit} combinations (by EV) for performance.` 
          };
      }

      function kellyFraction(odds, prob) {
        const b = odds - 1;
        const p = prob;
        const q = 1 - p;
        const k = (b * p - q) / b;
        if (!Number.isFinite(k) || k <= 0) return 0;
        return k * 0.25;
      }
      function computeKelly(parlays, bankroll) {
        const rows = parlays.map((p) => {
          const f = kellyFraction(p.combinedOdds, p.combinedProb);
          const stake = f > 0 ? bankroll * f : 0;
          return { ...p, fraction: f, stake };
        });
        const sumStake = rows.reduce((s, r) => s + r.stake, 0);
        if (sumStake > bankroll && sumStake > 0) {
          const scale = bankroll / sumStake;
          rows.forEach((r) => (r.stake = r.stake * scale));
        }
        rows.sort((a, b) => b.stake - a.stake);
        return rows;
      }
      function computeEqualStake(parlays, bankroll) {
        if (parlays.length === 0) return [];
        const stakeEach = bankroll / parlays.length;
        const rows = parlays.map((p) => ({ ...p, stake: stakeEach }));
        rows.sort((a, b) => b.combinedOdds - a.combinedOdds);
        return rows;
      }
      function computeYOLO(parlays, bankroll) {
        if (parlays.length === 0) return [];
        const best = [...parlays].sort((a, b) => b.combinedOdds - a.combinedOdds)[0];
        return [{ ...best, stake: bankroll, yolo: true }];
      }
      
      // Simulation Logic
      function simulateStrategy(fights, rows, bankroll, trials = 1000) {
          const results = [];
          const winners = fights.map((fight) => {
              const [a, b] = computeFightProbabilities(fight);
              return { a, b }; // We simulate based on User Probabilities
          });
          
          for(let i=0; i<trials; i++) {
              // 1. Simulate Outcomes
              const outcomes = {};
              winners.forEach((w, idx) => {
                  const fightId = idx + 1;
                  // Random vs A.prob
                  outcomes[fightId] = Math.random() < w.a.prob ? w.a.name : w.b.name;
              });
              
              // 2. Check Bets
              let currentBankroll = bankroll;
              let totalStaked = 0;
              let totalReturn = 0;
              
              rows.forEach(bet => {
                  totalStaked += bet.stake;
                  // Check if bet won
                  const won = bet.picks.every(p => outcomes[p.fight] === p.name);
                  if(won) {
                      totalReturn += bet.stake * bet.combinedOdds;
                  }
              });
              
              results.push(totalReturn - totalStaked);
          }
          results.sort((a, b) => a - b);
          const q = (p) => results[Math.floor(p * (results.length - 1))];
          return { median: q(0.5), p5: q(0.05), p95: q(0.95), drawdownProb: results.filter((x) => x < -0.3 * bankroll).length / results.length, results };
      }

      function countSharedLegs(rows) {
        if (!rows || rows.length < 2) return { fightsWithOverlap: 0, totalOverlaps: 0, worstFightPairs: 0 };
        const perFight = new Map();
        rows.forEach((r, rIdx) => {
          (r.picks || []).forEach((p) => {
            const key = `${p.fight}|${p.name}`;
            if (!perFight.has(key)) perFight.set(key, []);
            perFight.get(key).push(rIdx);
          });
        });
        let fightsWithOverlap = 0;
        let totalOverlaps = 0;
        const fightIdxs = new Map();
        perFight.forEach((arr, key) => {
          if (arr.length > 1) {
            fightsWithOverlap++;
            totalOverlaps += (arr.length - 1);
            const fnum = key.split("|")[0];
            if (!fightIdxs.has(fnum)) fightIdxs.set(fnum, 0);
            fightIdxs.set(fnum, fightIdxs.get(fnum) + 1);
          }
        });
        return { fightsWithOverlap, totalOverlaps, worstFightPairs: fightIdxs.size };
      }
      function buildCorrelationWarning(rows, metrics) {
        const singlesOnly = rows.every((r) => (r.picks || []).length <= 1);
        if (singlesOnly || rows.length < 2) return null;
        const overlap = countSharedLegs(rows);
        if (overlap.fightsWithOverlap === 0) return null;
        const severity = overlap.worstFightPairs >= 3 || overlap.totalOverlaps > 6 ? "severe"
                      : overlap.worstFightPairs >= 2 || overlap.totalOverlaps > 2 ? "moderate"
                      : "mild";
        const lossDiff = "closed-form " + pct(metrics.lossProb) + " likely understates true all-zero probability";
        const texts = {
          mild:    `⚠ ${overlap.worstFightPairs} fight(s) appear in multiple parlays — ` + lossDiff + ".",
          moderate:`⚠ ⚠ ${overlap.totalOverlaps} shared-leg overlaps across ${overlap.worstFightPairs} fights. Loss-probability & variance stats assume independence; the simulation is more trustworthy.`,
          severe:  `☢ Heavy shared-leg coupling (${overlap.worstFightPairs} fights × ${overlap.totalOverlaps} overlaps). Closed-form stats are materially optimistic — enable Monte Carlo and trust the P5/P95 tails, not the headline ${pct(metrics.lossProb)} loss%.`
        };
        const cls = severity === "severe" ? "border-red-500/40 bg-red-500/10 text-red-300"
                  : severity === "moderate" ? "border-orange-500/40 bg-orange-500/10 text-orange-300"
                  : "border-yellow-500/30 bg-yellow-500/10 text-yellow-300";
        return { text: texts[severity], cls };
      }
      function strategyMetrics(rows, bankroll) {
        const totalStake = rows.reduce((s, r) => s + r.stake, 0);
        const noWinProb = rows.reduce((s, r) => s * (1 - r.combinedProb), 1);
        const lossProb = Math.max(0, noWinProb);
        const outcomes = [];
        for (const r of rows) {
          const net = r.stake * r.combinedOdds - totalStake;
          outcomes.push({ prob: r.combinedProb, net });
        }
        outcomes.push({ prob: lossProb, net: -totalStake });
        const ev = outcomes.reduce((s, o) => s + o.prob * o.net, 0);
        const variance = outcomes.reduce((s, o) => s + o.prob * Math.pow(o.net - ev, 2), 0);
        const stdDev = Math.sqrt(Math.max(0, variance));
        const volRatio = totalStake > 0 && bankroll > 0 ? stdDev / bankroll : 0;
        const volLevel = volRatio < 0.1 ? "Low" : volRatio < 0.25 ? "Medium" : "High";
        const best = Math.max(...rows.map((r) => r.stake * r.combinedOdds - totalStake), -totalStake);
        return {
          lossProb,
          worstLoss: totalStake,
          exposurePct: totalStake / bankroll,
          variance,
          stdDev,
          volLevel,
          bestCase: best,
          ev,
        };
      }
      function classifyVerdict(m) {
        if (m.ev <= 0) return { label: "Dangerous", cardCls: "verdict-red", badgeCls: "badge badge-red" };
        if (m.exposurePct > 0.5 || m.lossProb > 0.7) return { label: "Dangerous", cardCls: "verdict-red", badgeCls: "badge badge-red" };
        if (m.ev > 0 && m.exposurePct <= 0.2 && m.lossProb <= 0.5) return { label: "Best", cardCls: "verdict-green", badgeCls: "badge badge-green" };
        if (m.ev > 0 && m.exposurePct <= 0.35) return { label: "Solid", cardCls: "verdict-cyan", badgeCls: "badge badge-cyan" };
        return { label: "Risky", cardCls: "verdict-yellow", badgeCls: "badge badge-yellow" };
      }
      function renderParlayRow(r, totalStake, rowIdx) {
        const picks = r.picks.map((p, pIdx) => {
          const cls = p.status === "lock" ? "lock-badge" : p.status === "fade" ? "fade-badge" : "neutral-badge";
          const label = p.status === "lock" ? "LOCK" : p.status === "fade" ? "FADE" : "NEUTRAL";
          const shortName = p.name.split(" ").reduce((acc, w, i, arr) => {
            if (arr.length === 1) return w.slice(0, 8);
            if (i === arr.length - 1) return acc + " " + w;
            return acc + (acc ? " " : "") + w.charAt(0) + ".";
          }, "");
          const uid = `pick-${rowIdx}-${pIdx}`;
          const legOdds = dec(p.odds || 0);
          const legProb = pct(p.prob || 0);
          return `
            <span class="pick-wrap inline-flex items-center gap-1 align-middle mr-2 mb-1" data-pick="${uid}">
              <button type="button" class="pick-toggle inline-flex items-center justify-center w-5 h-5 rounded border border-white/20 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white text-[10px] font-bold select-none shrink-0" data-toggle="${uid}" title="Show/hide pick details" aria-expanded="true">
                −
              </button>
              <span class="pick-expanded inline-flex items-center gap-1">
                <span class="font-semibold text-slate-100">F${p.fight}:</span>
                <span class="text-slate-100">${p.name}</span>
                <span class="text-[10px] px-2 py-0.5 rounded-md ${cls}">${label}</span>
                <span class="text-[10px] text-slate-400 font-mono pick-meta hidden lg:inline-flex">@ ${legOdds} · ${legProb}</span>
              </span>
              <span class="pick-collapsed inline-flex items-center gap-1 hidden">
                <span class="text-[11px] text-slate-400 font-semibold">F${p.fight}</span>
                <span class="text-[11px] text-slate-200">${shortName}</span>
              </span>
            </span>
          `;
        }).join("");
        const returnAmt = r.stake * r.combinedOdds;
        const netIfWin = returnAmt - totalStake;
        const stakeCell = `${money(r.stake)}${r.stake <= 0 ? ' <span class="text-[10px] text-slate-400">(no stake)</span>' : ''}`;
        const rowCls = netIfWin>=0 ? "row-pos" : "row-neg";
        return `
          <tr class="border-t border-white/10 ${rowCls}" data-row="${rowIdx}">
            <td class="px-3 py-2 text-sm">${picks}</td>
            <td class="px-3 py-2 text-sm font-mono text-slate-300">${dec(r.combinedOdds)}</td>
            <td class="px-3 py-2 text-sm font-mono text-slate-300">${pct(r.combinedProb)}</td>
            <td class="px-3 py-2 text-sm font-mono text-slate-300">${stakeCell}</td>
            <td class="px-3 py-2 text-sm font-mono text-slate-300">${money(returnAmt)}</td>
            <td class="px-3 py-2 text-sm font-mono ${netIfWin>=0?"text-green-400":"text-red-400"}">${money(netIfWin)}</td>
          </tr>
        `;
      }
      function attachPickToggles(rootEl) {
        if (!rootEl) return;
        rootEl.querySelectorAll("button[data-toggle]").forEach((btn) => {
          if (btn.dataset.bound === "1") return;
          btn.dataset.bound = "1";
          btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const uid = btn.getAttribute("data-toggle");
            const wrap = rootEl.querySelector(`span[data-pick="${uid}"]`);
            if (!wrap) return;
            const expanded = wrap.querySelector(".pick-expanded");
            const collapsed = wrap.querySelector(".pick-collapsed");
            const isExpanded = expanded && !expanded.classList.contains("hidden");
            if (isExpanded) {
              if (expanded) expanded.classList.add("hidden");
              if (collapsed) collapsed.classList.remove("hidden");
              btn.textContent = "+";
              btn.setAttribute("aria-expanded", "false");
            } else {
              if (expanded) expanded.classList.remove("hidden");
              if (collapsed) collapsed.classList.add("hidden");
              btn.textContent = "−";
              btn.setAttribute("aria-expanded", "true");
            }
            playSoftClickSound();
          });
        });
      }
      function playSoftClickSound() {
        try {
          if (!audioCtx || audioCtx.state === "suspended") {
            if (audioCtx) audioCtx.resume();
            return;
          }
          const o = audioCtx.createOscillator();
          const g = audioCtx.createGain();
          o.type = "square";
          o.frequency.setValueAtTime(480, audioCtx.currentTime);
          g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
          g.gain.exponentialRampToValueAtTime(0.025, audioCtx.currentTime + 0.005);
          g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.05);
          o.connect(g); g.connect(audioCtx.destination);
          o.start(); o.stop(audioCtx.currentTime + 0.06);
        } catch (_) {}
      }
      function renderStrategy(name, rows, bankroll, opts = {}) {
        const allocPct = opts.allocPct ?? 100;
        const scaled = getScaledRows(rows, allocPct);
        const totalStake = scaled.reduce((s, r) => s + r.stake, 0);
        const metrics = strategyMetrics(scaled, bankroll);
        const corrWarn = buildCorrelationWarning(scaled, metrics);
        const isSingles = name.toLowerCase().includes("singles");
        const sim = opts.sim;
        const mcOn = !!sim;
        const headerSubCls = mcOn
          ? "bg-gradient-to-r from-cyan-500/10 via-slate-500/10 to-cyan-500/10 border-cyan-400/30"
          : "";
        const cardExtraCls = isSingles ? "ring-1 ring-emerald-400/20" : "";
        const singlesRibbon = isSingles
          ? `<div class="absolute -top-2 -right-2 text-[10px] px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shadow-[0_0_14px_rgba(16,185,129,0.25)] z-10 font-bold tracking-wide">RECOMMENDED · No vig compounding</div>`
          : "";
        const warn = opts.warn ? `<div class="text-xs text-red-400 mb-2">${opts.warn}</div>` : "";
        const trunc = opts.truncationWarn ? `<div class="text-[11px] text-orange-300">${opts.truncationWarn}</div>` : "";
        const corrWarnHtml = corrWarn
          ? `<div class="text-[11px] mt-2 p-2 rounded-md border ${corrWarn.cls} font-medium leading-relaxed">${corrWarn.text}</div>`
          : "";
        const headEvLine = mcOn
          ? `<div class="text-[11px] text-slate-400 mt-1">
               <span class="text-cyan-300 font-semibold">MC median: ${money(sim.median)}</span>
               <span class="mx-1">·</span>
               <span class="${sim.p5 < 0 ? 'text-red-300' : 'text-slate-300'}">P5 ${money(sim.p5)}</span>
               <span class="mx-1">·</span>
               <span class="text-slate-300">P95 ${money(sim.p95)}</span>
               <span class="mx-1">·</span>
               <span class="${sim.drawdownProb > 0.1 ? 'text-red-300' : 'text-slate-300'}">>30% dd: ${pct(sim.drawdownProb)}</span>
             </div>`
          : `<div class="mt-2 text-[11px] text-slate-400">
               <span class="${metrics.ev>=0?'text-green-400':'text-red-400'}">${money(metrics.ev)} EV</span>
               <span class="mx-1">•</span>
               <span>${pct(metrics.lossProb)} loss</span>
               <span class="mx-1">•</span>
               <span>${pct(metrics.exposurePct)} exposed</span>
             </div>`;
        const sparkTitle = mcOn
          ? `<div class="text-[11px] text-cyan-300 font-medium mb-1">📈 Profit/Loss Distribution — Monte Carlo 10k trials (trust this)</div>`
          : `<div class="text-[11px] text-slate-400 mb-1">Parlay EV Profile (closed-form, leg-independence assumed)</div>`;
        const table =
          scaled.length === 0
            ? `<div class="text-sm text-slate-400">No valid parlays</div>`
            : `
          <div class="overflow-x-auto rounded-lg border border-white/10 max-h-[400px] overflow-y-auto custom-scrollbar">
            <table class="min-w-full text-left text-slate-200 text-sm">
              <thead class="bg-white/5 thead-luminous sticky top-0 z-20">
                <tr>
                  <th scope="col" class="px-3 py-2">Parlay Picks</th>
                <th scope="col" class="px-3 py-2">Decimal Odds</th>
                <th scope="col" class="px-3 py-2">Implied Prob</th>
                <th scope="col" class="px-3 py-2">Stake</th>
                <th scope="col" class="px-3 py-2">Potential Return</th>
                <th scope="col" class="px-3 py-2">Net Result</th>
                </tr>
              </thead>
              <tbody class="parlay-table-body">
                ${scaled.slice(0, 20).map((r, idx) => renderParlayRow(r, totalStake, idx)).join("")}
              </tbody>
            </table>
            ${scaled.length > 20 ? `
              <div class="p-3 text-center border-t border-white/10 bg-white/5">
                <button type="button" class="load-more-parlays text-[11px] font-bold uppercase tracking-widest text-anthropic-blue hover:text-anthropic-blue/80 transition-colors" data-strategy="${name}">
                  + Show All ${scaled.length} Combinations
                </button>
              </div>
            ` : ""}
          </div>
        `;
        const mcSection = mcOn
          ? `
          <div class="rounded-xl border border-cyan-500/30 bg-cyan-500/5 p-4 mb-2 shadow-[0_0_30px_rgba(6,182,212,0.06)]">
            <div class="flex items-center justify-between mb-3">
              <div class="text-xs text-cyan-300 font-semibold tracking-wide">
                ● Monte Carlo (10,000 correlated trials) — most trustworthy stats
              </div>
              <div class="text-[10px] text-cyan-400/70 font-mono">samples fight-by-fight, captures shared-leg effects</div>
            </div>
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div class="rounded-lg border border-white/10 bg-white/5 p-3">
                <div class="text-xs text-slate-400">Median Outcome</div>
                <div class="text-base font-mono text-cyan-200">${money(sim.median)}</div>
              </div>
              <div class="rounded-lg border border-white/10 bg-white/5 p-3">
                <div class="text-xs text-slate-400">P5 (bad-tail loss)</div>
                <div class="text-base font-mono ${sim.p5 < 0 ? 'text-red-300' : 'text-slate-200'}">${money(sim.p5)}</div>
              </div>
              <div class="rounded-lg border border-white/10 bg-white/5 p-3">
                <div class="text-xs text-slate-400">P95 (good-tail gain)</div>
                <div class="text-base font-mono text-emerald-300">${money(sim.p95)}</div>
              </div>
              <div class="rounded-lg border border-white/10 bg-white/5 p-3">
                <div class="text-xs text-slate-400">Drawdown > 30%</div>
                <div class="text-base font-mono ${sim.drawdownProb > 0.1 ? 'text-red-300' : 'text-slate-200'}">${pct(sim.drawdownProb)}</div>
              </div>
            </div>
          </div>
          ` : "";
        const cfDim = mcOn ? "opacity-60 grayscale-[0.4]" : "";
        const cfDisclaimer = mcOn
          ? `<div class="col-span-full text-[10px] text-slate-500 italic -mt-1 mb-1">Closed-form stats below assume independent parlay outcomes — they are approximate and understate tail risk.</div>`
          : "";
        const vigNote = !isSingles && scaled.some(r => (r.picks||[]).length > 1)
          ? `<div class="col-span-full text-[11px] text-amber-300/80 p-2 rounded-md border border-amber-500/20 bg-amber-500/5">
               💡 Parlay vig compounds multiplicatively across legs: the same money on Singles almost always has higher EV and lower variance. Use parlays for fun, not for Kelly-optimal sizing.
             </div>`
          : "";
        const card = document.createElement("div");
        const verdict = classifyVerdict(metrics);
        card.className = `rounded-2xl border bg-white/5 backdrop-blur-md shadow-glow strategy-card relative ${verdict.cardCls} ${headerSubCls} ${cardExtraCls}`;
        card.innerHTML = `
          <div class="strategy-card-header p-4 sm:p-4 border-b border-white/10 flex items-start justify-between">
            <div class="flex-1 min-w-0">
              <div class="flex items-start justify-between gap-2">
                <div>
                  <h3 class="text-sm font-medium">${name}${isSingles ? ` <span class="text-[10px] align-middle ml-1 px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">mathematically preferred</span>` : ''}</h3>
                  ${warn}
                  ${trunc}
                  ${corrWarnHtml}
                </div>
                ${singlesRibbon}
              </div>
              <div class="mt-2 flex items-center gap-2">
                <span class="${verdict.badgeCls}">${verdict.label}</span>
                <div class="text-[11px] text-slate-400">
                  <span class="${metrics.ev>=0?'text-green-400':'text-red-400'}">${money(metrics.ev)} CF EV</span>
                  • ${pct(metrics.lossProb)} loss • ${pct(metrics.exposurePct)} exposed
                </div>
              </div>
              ${headEvLine}
              <div class="mt-2">
                ${sparkTitle}
                <div class="relative w-full aspect-[4/1] min-h-[80px]">
                  <canvas class="sparkline"></canvas>
                </div>
              </div>
              <div class="mt-2 flex items-center gap-2">
                <label for="stake-${slugifyName(name)}" class="text-[11px] text-slate-400">Stake %</label>
                <input id="stake-${slugifyName(name)}" type="range" min="0" max="100" value="${allocPct}" data-alloc="${name}" class="w-24 accent-red-500" aria-label="Adjust stake percentage for ${name} strategy">
                <span class="text-[11px] text-slate-300">${allocPct.toFixed(0)}%</span>
              </div>
            </div>
            <div class="text-right ml-4 shrink-0">
              <div class="text-[11px] text-slate-400">Total Stake: ${money(totalStake)}</div>
              <div class="mt-2 h-1.5 w-24 bg-white/10 rounded-full overflow-hidden">
                <div class="stake-bar h-full" style="width:${(metrics.exposurePct*100).toFixed(2)}%"></div>
              </div>
              <button class="mt-2 sm:hidden text-[11px] px-2 py-1 rounded-md bg-white/10 border border-white/10" data-collapse>Details</button>
            </div>
          </div>
          <div class="strategy-body p-5 sm:p-6 space-y-3 hidden sm:block">
            ${mcSection}
            ${table}
            <div class="grid grid-cols-2 sm:grid-cols-3 gap-3 ${cfDim}">
              ${cfDisclaimer}
              <div class="rounded-lg border border-white/10 bg-white/5 p-3">
                <div class="text-xs text-slate-400">Prob. Total Loss (approx)</div>
                <div class="text-sm font-mono text-slate-200">${pct(metrics.lossProb)}</div>
                <div class="text-[11px] text-slate-400">Independence assumed; use MC above.</div>
              </div>
              <div class="rounded-lg border border-white/10 bg-white/5 p-3">
                <div class="text-xs text-slate-400">Worst-case Loss</div>
                <div class="text-sm font-mono text-slate-200">${money(metrics.worstLoss)}</div>
              </div>
              <div class="rounded-lg border border-white/10 bg-white/5 p-3">
                <div class="text-xs text-slate-400">Bankroll Exposure</div>
                <div class="text-sm font-mono text-slate-200">${pct(metrics.exposurePct)}</div>
              </div>
              <div class="rounded-lg border border-white/10 bg-white/5 p-3">
                <div class="text-xs text-slate-400">Variance (unit²)</div>
                <div class="text-sm font-mono text-slate-200">${metrics.variance.toFixed(2)}</div>
              </div>
              <div class="rounded-lg border border-white/10 bg-white/5 p-3">
                <div class="text-xs text-slate-400">Best-case Return</div>
                <div class="text-sm font-mono text-slate-200">${money(metrics.bestCase)}</div>
              </div>
              <div class="rounded-lg border border-white/10 bg-white/5 p-3">
                <div class="text-xs text-slate-400">Expected Value</div>
                <div class="text-sm font-mono text-slate-200">${money(metrics.ev)}</div>
              </div>
              <div class="rounded-lg border border-white/10 bg-white/5 p-3">
                <div class="text-xs text-slate-400">Std Dev</div>
                <div class="text-sm font-mono text-slate-200">${money(metrics.stdDev)}</div>
              </div>
              <div class="rounded-lg border border-white/10 bg-white/5 p-3">
                <div class="text-xs text-slate-400">Volatility Level</div>
                <div class="text-sm font-mono text-slate-200">${metrics.volLevel}</div>
              </div>
              <div class="rounded-lg border border-white/10 bg-white/5 p-3">
                <div class="text-xs text-slate-400">Edge (EV / Stake)</div>
                <div class="text-sm font-mono text-slate-200">${metrics.worstLoss>0 ? pct(metrics.ev/metrics.worstLoss) : "—"}</div>
              </div>
              <div class="rounded-lg border border-white/10 bg-white/5 p-3">
                <div class="text-[11px] text-slate-400 mb-1">EV/Vol/Exp</div>
                <div class="relative w-full aspect-[4/1]">
                  <canvas class="bars"></canvas>
                </div>
              </div>
              ${vigNote}
            </div>
            <div class="flex flex-wrap gap-2">
              ${buildWarnings(metrics).map(w => `<span class="text-[11px] px-2 py-1 rounded-md border border-white/10 bg-white/5 warn-glow ${w.cls}">${w.text}</span>`).join("")}
              ${fightnomicsAlignmentChip(typeof readFights === "function" ? readFights() : [])}
              ${mcOn ? `<span class="text-[11px] px-2 py-1 rounded-md border border-cyan-500/30 bg-cyan-500/10 text-cyan-300 font-medium">🎯 Monte Carlo active — lead with the cyan panel</span>` : `<span class="text-[11px] px-2 py-1 rounded-md border border-slate-500/20 bg-slate-500/10 text-slate-300">Enable Monte Carlo above for correlation-aware tail stats.</span>`}
            </div>
          </div>
        `;
        const spark = card.querySelector("canvas.sparkline");
        if (spark) {
          if (sim && sim.results && sim.results.length > 0) {
              drawMonteCarloDistribution(spark, sim.results, bankroll);
          } else {
              const evVals = scaled.map((r) => {
                const ret = r.stake * r.combinedOdds;
                const netWin = ret - totalStake;
                const netLoss = -totalStake;
                return r.combinedProb * netWin + (1 - r.combinedProb) * netLoss;
              });
              drawSparkline(spark, evVals.slice(0, Math.min(evVals.length, 24)));
          }
        }
        const bars = card.querySelector("canvas.bars");
        drawBars(bars, metrics);
        attachPickToggles(card);
        const body = card.querySelector(".strategy-body");
        const collapseBtn = card.querySelector("[data-collapse]");
        if (collapseBtn && body) {
          const key = "strategy-collapse:" + slugifyName(name);
          const state = localStorage.getItem(key);
          if (state === "open") body.classList.remove("hidden");
          else if (state === "closed") body.classList.add("hidden");
          collapseBtn.addEventListener("click", () => {
            body.classList.toggle("hidden");
            localStorage.setItem(key, body.classList.contains("hidden") ? "closed" : "open");
          });
        }
        return { card, metrics, sim: opts.sim, name };
      }
      function animateValue(obj, start, end, duration) {
        let startTimestamp = null;
        const step = (timestamp) => {
          if (!startTimestamp) startTimestamp = timestamp;
          const progress = Math.min((timestamp - startTimestamp) / duration, 1);
          // Ease out cubic
          const ease = 1 - Math.pow(1 - progress, 3);
          const current = start + (end - start) * ease;
          obj.innerHTML = money(current);
          if (progress < 1) {
            window.requestAnimationFrame(step);
          } else {
             obj.innerHTML = money(end);
          }
        };
        window.requestAnimationFrame(step);
      }

      function fightnomicsCardTrust(fights) {
        let totalFilled = 0; let totalSlots = 0; let alignGood = 0; let fightsScored = 0; let strongEdges = 0; let weakEdges = 0; let noisyEdges = 0;
        const perFight = (fights||[]).map(fight => {
          const fA = fight.fighters?.[0]; const fB = fight.fighters?.[1];
          const bioA = fA?.name ? resolveFighterBio?.(fA.name) : null;
          const bioB = fB?.name ? resolveFighterBio?.(fB.name) : null;
          const hasStatsA = bioA && typeof bioA === "object";
          const hasStatsB = bioB && typeof bioB === "object";
          const perfKeys = ["slpm","stracc","sapm","strdef","td15m","tdacc","tddef","sub15m"];
          let filledA = 0; let filledB = 0;
          perfKeys.forEach(k => { if (hasStatsA && typeof bioA[k] === "number") filledA++; if (hasStatsB && typeof bioB[k] === "number") filledB++; });
          const oA = fA?.odds; const oB = fB?.odds;
          const cA = (fA?.confidence ?? 50); const cB = (fB?.confidence ?? 50);
          let align = null; let edgeTier = null; let priorPA = null;
          if (hasStatsA && hasStatsB && FN) {
            try {
              const ctx = { oddsA: (oA && isFinite(oA) && oA>1) ? oA : null, oddsB: (oB && isFinite(oB) && oB>1) ? oB : null };
              const pr = FN.fightnomicsPrior(FN.normalizeFighter(bioA), FN.normalizeFighter(bioB), ctx);
              priorPA = pr.pA;
              const userNorm = (cA / Math.max(1, cA + cB));
              const delta = Math.abs(userNorm - pr.pA);
              if (delta < 0.06) align = "good"; else if (delta < 0.15) align = "ok"; else align = "off";
              if (ctx.oddsA && ctx.oddsB) {
                const mk = FN.removeVigFromOdds(ctx.oddsA, ctx.oddsB);
                const e = FN.edgeVsMarket(userNorm, mk.pA, userNorm, 1-userNorm, pr.pA);
                edgeTier = e.tier;
              }
            } catch(_) {}
          }
          const fillRate = (filledA + filledB) / 16;
          totalFilled += (filledA + filledB); totalSlots += 16;
          if (align) fightsScored++;
          if (align === "good") alignGood++;
          if (edgeTier === "STRONG" || edgeTier === "GENUINE") strongEdges++;
          else if (edgeTier === "WEAK") weakEdges++;
          else if (edgeTier === "NOISY") noisyEdges++;
          return { id: fight.id, fillRate, align, edgeTier, priorPA };
        });
        const overallFill = totalSlots ? totalFilled/totalSlots : 0;
        const alignRate = fightsScored ? alignGood / fightsScored : null;
        return { perFight, overallFill, alignRate, fightsScored, strongEdges, weakEdges, noisyEdges, totalFilled, totalSlots };
      }

      function fightnomicsAlignmentChip(fights) {
        const t = fightnomicsCardTrust(fights);
        if (!FN) return "";
        if (!t.fightsScored && t.overallFill < 0.2) return `<span class="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-anthropic-mid/30 bg-anthropic-mid/10 text-anthropic-mid text-[10px] font-bold uppercase tracking-wider">⚪ No Data</span>`;
        let cls = "border-anthropic-mid/30 bg-anthropic-mid/10 text-anthropic-mid";
        let label = "⚪ Mixed";
        if (t.overallFill >= 0.7 && (t.alignRate ?? 1) >= 0.66) {
          cls = "border-anthropic-green/40 bg-anthropic-green/15 text-anthropic-green";
          label = "🟢 FN Aligned";
        } else if (t.overallFill >= 0.4) {
          cls = "border-anthropic-orange/40 bg-anthropic-orange/15 text-anthropic-orange";
          label = "🟡 Partial";
        } else if (t.overallFill < 0.4) {
          cls = "border-anthropic-orange/60 bg-anthropic-orange/20 text-anthropic-orange font-black";
          label = "🔴 Low Data";
        }
        const pctFill = (t.overallFill*100).toFixed(0);
        const align = t.alignRate != null ? `· ${(t.alignRate*100).toFixed(0)}% sync` : "";
        return `<span class="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border ${cls} text-[10px] font-bold uppercase tracking-wider" title="Fightnomics data-fill: ${pctFill}% · User-vs-FN sync: ${align}">${label} · ${pctFill}% Data ${align}</span>`;
      }

      function renderRiskSummary(items) {
        destroyChartsInContainer(riskSummary);
        riskSummary.innerHTML = "";
        const anyMC = items.some((it) => !!it.sim);
        let ranked;
        if (anyMC) {
          ranked = [...items].sort((a, b) => {
            const medA = a.sim ? a.sim.median : a.metrics.ev;
            const medB = b.sim ? b.sim.median : b.metrics.ev;
            return medB - medA;
          });
        } else {
          ranked = [...items].sort((a, b) => b.metrics.ev - a.metrics.ev);
        }
        const best = ranked[0];

        // 1. Radar Chart Comparison
        const radarWrap = document.createElement("div");
        radarWrap.className = "rounded-2xl border border-white/10 bg-black/20 p-5 mb-6 h-64 shadow-inner relative overflow-hidden";
        radarWrap.innerHTML = `
          <div class="flex items-center justify-between mb-2">
            <div class="text-[10px] uppercase tracking-[0.2em] text-anthropic-mid font-black">Strategy Risk Topology</div>
            <div class="flex items-center gap-2">
              <span class="w-2 h-2 rounded-full bg-anthropic-orange"></span>
              <span class="text-[9px] text-anthropic-mid font-bold uppercase">${best.name}</span>
            </div>
          </div>
          <canvas class="strategy-radar-canvas"></canvas>
        `;
        riskSummary.appendChild(radarWrap);

        const radarDatasets = items.map((it, idx) => {
          const m = it.metrics;
          const s = it.sim;
          const isBest = it.name === best.name;
          
          // Heuristic normalization for radar (0-100)
          const evVal = s ? s.median : m.ev;
          const evScore = Math.max(0, Math.min(100, (evVal / 200) * 100)); 
          const winScore = Math.max(0, Math.min(100, (1 - m.lossProb) * 100));
          const expScore = Math.max(0, Math.min(100, (m.exposurePct * 2) * 100)); // weighted exposure
          const stabScore = s ? (1 - s.drawdownProb) * 100 : 70;
          const safeTail = s ? Math.max(0, Math.min(100, 100 + (s.p5 / 5))) : 50;

          return {
            label: it.name,
            data: [evScore, winScore, expScore, stabScore, safeTail],
            fill: true,
            backgroundColor: isBest ? 'rgba(217, 119, 87, 0.2)' : 'rgba(106, 155, 204, 0.05)',
            borderColor: isBest ? '#d97757' : 'rgba(106, 155, 204, 0.3)',
            borderWidth: isBest ? 2 : 1,
            pointRadius: isBest ? 3 : 0,
            tension: 0.2
          };
        });
        
        setTimeout(() => {
          const canvas = radarWrap.querySelector('.strategy-radar-canvas');
          if (canvas) initStrategyRadar(canvas, radarDatasets);
        }, 0);

        const top = document.createElement("div");
        top.className = "rounded-2xl border border-anthropic-orange/30 bg-anthropic-orange/5 p-5 mb-6 shadow-glow";
        const bestHeadVal = best.sim
          ? `<span class="${best.sim.median < 0 ? 'text-anthropic-orange' : 'text-anthropic-blue'} font-black text-lg">MC Median ${money(best.sim.median)}</span>
             <div class="mt-2 flex gap-4 text-[10px] text-anthropic-mid uppercase tracking-widest font-bold">
               <span>P5 ${money(best.sim.p5)}</span>
               <span>P95 ${money(best.sim.p95)}</span>
             </div>`
          : `<span class="${best.metrics.ev < 0 ? 'text-anthropic-orange' : 'text-anthropic-green'} font-black text-lg">CF EV ${money(best.metrics.ev)}</span>`;
        
        top.innerHTML = `
          <div class="flex items-center justify-between mb-4">
            <div class="text-[10px] uppercase tracking-[0.2em] text-anthropic-orange font-black">Optimal Strategy Recommendation</div>
            <span class="px-3 py-1 rounded-md border border-anthropic-orange/40 bg-anthropic-orange/15 text-anthropic-orange text-[10px] font-black uppercase tracking-wider">${best.name}</span>
          </div>
          <div class="anim-val-wrap flex flex-col gap-1">${bestHeadVal}</div>
          <div class="mt-5 pt-5 border-t border-white/10 grid grid-cols-2 gap-6 text-[11px]">
            <div class="stat-item bg-transparent border-0 p-0">
              <div class="stat-label text-left opacity-60">Theoretical Loss</div>
              <div class="stat-value text-left text-lg text-anthropic-light">${pct(best.metrics.lossProb)}</div>
            </div>
            <div class="stat-item bg-transparent border-0 p-0">
              <div class="stat-label text-left opacity-60">Portfolio Exposure</div>
              <div class="stat-value text-left text-lg text-anthropic-light">${pct(best.metrics.exposurePct)}</div>
            </div>
          </div>
        `;
        riskSummary.appendChild(top);

        const banner = document.createElement("div");
        banner.className = "rounded-xl border border-white/10 bg-white/5 p-4 mb-6 text-[11px] leading-relaxed text-anthropic-mid";
        banner.innerHTML = anyMC
          ? `<b class="text-anthropic-blue uppercase tracking-widest text-[10px]">● Monte Carlo Engine Active</b><br>Capturing shared-leg correlations via 10,000 trials. Tail-risk (P5/P95) is more reliable than closed-form variance.`
          : `<b class="text-anthropic-mid uppercase tracking-widest text-[10px]">○ Standard Mode</b><br>Leg-independence assumed. CF metrics may be optimistic for overlapping parlays. Enable Monte Carlo for tail-risk analysis.`;
        riskSummary.appendChild(banner);
        const fightsForTrust = typeof readFights === "function" ? readFights() : [];
        const trust = fightnomicsCardTrust(fightsForTrust);
        const trustBlock = document.createElement("div");
        trustBlock.className = "rounded-xl border border-cyan-600/20 bg-cyan-500/5 p-3 mb-4 text-[11px] leading-relaxed";
        const fillPct = (trust.overallFill*100).toFixed(0);
        const alignPct = trust.alignRate != null ? `· User/FN alignment: ${(trust.alignRate*100).toFixed(0)}% within ±6pp (${trust.fightsScored}/${fightsForTrust.length||1} scored)` : "";
        const edgeParts = [];
        if (trust.strongEdges) edgeParts.push(`${trust.strongEdges} STRONG/GENUINE`);
        if (trust.weakEdges) edgeParts.push(`${trust.weakEdges} WEAK`);
        if (trust.noisyEdges) edgeParts.push(`${trust.noisyEdges} NOISY`);
        const edgeStr = edgeParts.length ? `· Edge tiers: ${edgeParts.join(" / ")}` : "";
        let badge = `<span class="inline-flex px-2 py-0.5 rounded-md border border-slate-700 bg-slate-700/40 text-slate-300 text-[10px] font-semibold mr-2">⚪ No Fightnomics data</span>`;
        if (trust.overallFill >= 0.7 && (trust.alignRate ?? 1) >= 0.66) {
          badge = `<span class="inline-flex px-2 py-0.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 text-[10px] font-semibold mr-2">🟢 High trustworthiness</span>`;
        } else if (trust.overallFill >= 0.4) {
          badge = `<span class="inline-flex px-2 py-0.5 rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-300 text-[10px] font-semibold mr-2">🟡 Moderate trustworthiness</span>`;
        } else if (trust.totalFilled > 0) {
          badge = `<span class="inline-flex px-2 py-0.5 rounded-md border border-rose-500/40 bg-rose-500/10 text-rose-300 text-[10px] font-semibold mr-2">🔴 Low trustworthiness</span>`;
        }
        trustBlock.innerHTML = `<div class="flex flex-wrap items-center gap-2"><div class="font-semibold tracking-wide text-cyan-300">Model Trustworthiness</div>${badge}<div class="text-slate-400">FightMetric data-fill ${fillPct}% (${trust.totalFilled}/${trust.totalSlots||0} filled) ${alignPct} ${edgeStr}</div></div>
          <div class="mt-2 text-[10px] text-slate-400 leading-tight">📚 Fightnomics + MMA Bets + UFC Stats integration. Pick fighters via autocomplete + enter odds to populate. <span class="text-cyan-300/90">Calibrated priors are BASE-RATES ONLY</span> — injuries, weight cuts, or stylistic matchups (e.g., striker vs grappler style-clash) aren't in the data. Always override with your own edge.</div>`;
        riskSummary.appendChild(trustBlock);
        const fnChipInRow = fightnomicsAlignmentChip(fightsForTrust);
        items.forEach((it) => {
          const hasMC = !!it.sim;
          const row = document.createElement("div");
          const isSingles = (it.name || "").toLowerCase().includes("singles");
          const singlesBadge = isSingles
            ? `<span class="text-[10px] align-middle ml-1 px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">preferred</span>`
            : "";
          row.className = `rounded-xl border ${isSingles ? 'border-emerald-500/25 ring-1 ring-emerald-500/10' : 'border-white/10'} bg-white/5 p-4`;
          const mcBlock = hasMC
            ? `
              <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm mb-4 p-4 rounded-xl border border-anthropic-blue/20 bg-anthropic-blue/5 shadow-inner">
                <div class="stat-item bg-transparent border-0 p-0">
                  <div class="stat-label text-left text-[9px] text-anthropic-blue/70">MC Median</div>
                  <div class="stat-value text-left text-base text-anthropic-blue">${money(it.sim.median)}</div>
                </div>
                <div class="stat-item bg-transparent border-0 p-0">
                  <div class="stat-label text-left text-[9px] text-anthropic-mid/70">P5 (Tail Risk)</div>
                  <div class="stat-value text-left text-base ${it.sim.p5 < 0 ? 'text-anthropic-orange' : 'text-anthropic-light'}">${money(it.sim.p5)}</div>
                </div>
                <div class="stat-item bg-transparent border-0 p-0">
                  <div class="stat-label text-left text-[9px] text-anthropic-mid/70">P95 (Upside)</div>
                  <div class="stat-value text-left text-base text-anthropic-green">${money(it.sim.p95)}</div>
                </div>
                <div class="stat-item bg-transparent border-0 p-0">
                  <div class="stat-label text-left text-[9px] text-anthropic-mid/70">>30% Drawdown</div>
                  <div class="stat-value text-left text-base ${it.sim.drawdownProb > 0.1 ? 'text-anthropic-orange' : 'text-anthropic-light'}">${pct(it.sim.drawdownProb)}</div>
                </div>
              </div>
            `
            : `
              <div class="text-[11px] font-mono tracking-tight text-anthropic-mid/60 mb-4 p-3 rounded-lg border border-white/5 bg-white/5 italic">
                ○ Monte Carlo inactive — showing theoretical approximations only.
              </div>
            `;
          const cfDim = hasMC ? "opacity-60 grayscale-[0.35]" : "";
          row.innerHTML = `
            <div class="flex flex-wrap items-center justify-between mb-2 gap-2">
              <div class="flex flex-wrap items-center gap-2 text-sm font-medium">${it.name}${singlesBadge}${fnChipInRow ? fnChipInRow : ""}</div>
              <div class="text-xs text-slate-400 font-mono">Exposure ${pct(it.metrics.exposurePct)}</div>
            </div>
            ${mcBlock}
            <div class="text-[10px] uppercase tracking-widest text-slate-500 mb-1">Closed-form (independence assumed${hasMC ? ' · de-emphasized' : ''})</div>
            <div class="grid grid-cols-2 gap-3 text-sm ${cfDim}">
              <div>CF EV: <span class="text-slate-200 font-mono">${money(it.metrics.ev)}</span></div>
              <div>Loss Prob (approx): <span class="text-slate-200 font-mono">${pct(it.metrics.lossProb)}</span></div>
              <div>Total Stake: <span class="text-slate-200 font-mono">${money(it.metrics.worstLoss)}</span></div>
              <div>Variance (unit²): <span class="text-slate-200 font-mono">${it.metrics.variance.toFixed(2)}</span></div>
              <div>Std Dev: <span class="text-slate-200 font-mono">${money(it.metrics.stdDev)}</span></div>
              <div>Volatility: <span class="text-slate-200 font-mono">${it.metrics.volLevel}</span></div>
              <div>Best-case: <span class="text-slate-200 font-mono">${money(it.metrics.bestCase)}</span></div>
              <div>Edge (EV / Stake): <span class="text-slate-200 font-mono">${it.metrics.worstLoss>0 ? pct(it.metrics.ev/it.metrics.worstLoss) : "—"}</span></div>
            </div>
          `;
          riskSummary.appendChild(row);
        });
        
        // Trigger animations
        setTimeout(() => {
           top.querySelectorAll('.anim-val').forEach(el => {
               const val = parseFloat(el.getAttribute('data-val'));
               if (!isNaN(val)) animateValue(el, 0, val, 1000);
           });
        }, 100);
      }
      async function calculate() {
        if (!formValid()) {
          if (calcError) {
            calcError.textContent = "Fix validation errors before calculating.";
            calcError.classList.remove("hidden");
          }
          return;
        }
        if (calcError) {
          calcError.textContent = "";
          calcError.classList.add("hidden");
        }
        if (loadingMsg) loadingMsg.textContent = "";
        
        calcBtn.disabled = true;
        calcBtn.classList.add("opacity-50", "cursor-wait");
        exportBtn.disabled = true;
        exportBtn.title = "Results not ready yet";
        const bankroll = parseFloat(bankrollEl.value);
        if (!Number.isFinite(bankroll) || bankroll <= 0) {
          if (calcError) {
            calcError.textContent = "Bankroll must be > 0.";
            calcError.classList.remove("hidden");
          }
          return;
        }
        const fights = readFights();
        const startTime = performance.now();
        const parlaysAll = generateParlays(fights);
        logPerformance("Parlay Generation", startTime);

        const truncStartTime = performance.now();
        let truncWarnMsg = "";
        let useParlays = parlaysAll;
        if (parlaysAll.length > 256) {
          const trunc = truncateParlaysByKelly(parlaysAll, bankroll, 256);
          useParlays = trunc.rows;
          truncWarnMsg = trunc.warn;
          const tw = document.getElementById("truncWarn"); if (tw) tw.textContent = truncWarnMsg;
        } else {
          const tw = document.getElementById("truncWarn"); if (tw) tw.textContent = "";
        }
        logPerformance("Parlay Truncation", truncStartTime);

        const mathStartTime = performance.now();
        const kellyRows = computeKelly(useParlays, bankroll);
        const equalRows = computeEqualStake(useParlays, bankroll);
        const yoloRows = computeYOLO(useParlays, bankroll);
        const singlesRows = computeSinglesRows(fights, bankroll);
        logPerformance("Strategy Math (Kelly/Equal/YOLO)", mathStartTime);

        destroyChartsInContainer(resultsContainer);
        resultsContainer.innerHTML = "";
        const mcOn = document.getElementById("mcToggle")?.checked;
        let kSim, eSim, ySim, sSim;
        
        const simStartTime = performance.now();

        if (mcOn) {
          const trials = 10000;
          const totalTrials = trials * 4;
          let completedTrials = 0;
          
          let lastProgressUpdate = 0;
          const updateOverallProgress = (newDone) => {
            completedTrials += newDone;
            const now = performance.now();
            if (now - lastProgressUpdate < 100 && completedTrials < totalTrials) return;
            lastProgressUpdate = now;

            const progress = Math.min(100, Math.round((completedTrials / totalTrials) * 100));
            const loadingBar = document.getElementById("loadingBar");
            const loadingPct = document.getElementById("loadingPct");
            const progressContainer = document.getElementById("progressBarContainer");
            if (loadingBar) loadingBar.style.width = `${progress}%`;
            if (loadingPct) loadingPct.textContent = `${progress}%`;
            if (progressContainer) progressContainer.setAttribute("aria-valuenow", progress);
          };

          if (loadingMsg) loadingMsg.textContent = "Simulating all strategies in parallel...";
          const loadingWrap = document.getElementById("loadingWrap");
          if (loadingWrap) loadingWrap.classList.remove("hidden");

          [kSim, eSim, ySim, sSim] = await Promise.all([
            runMonteCarloAsync(fights, kellyRows, bankroll, trials, updateOverallProgress),
            runMonteCarloAsync(fights, equalRows, bankroll, trials, updateOverallProgress),
            runMonteCarloAsync(fights, yoloRows, bankroll, trials, updateOverallProgress),
            runMonteCarloAsync(fights, singlesRows, bankroll, trials, updateOverallProgress)
          ]);

          if (loadingMsg) loadingMsg.textContent = "";
          setTimeout(() => {
            if (loadingWrap) loadingWrap.classList.add("hidden");
          }, 800);
        }
        
        logPerformance("Strategy Calculation & Simulation", simStartTime);
        
        const renderStartTime = performance.now();
        const sCard = renderStrategy("Single Bets (Kelly-optimized)", singlesRows, bankroll, { sim: sSim, allocPct: strategyAllocations.Singles });
        const kCard = renderStrategy("Fractional Kelly (Minimum Risk)", kellyRows, bankroll, { truncationWarn: truncWarnMsg, sim: kSim, allocPct: strategyAllocations.Kelly });
        const eCard = renderStrategy("Equal Stake Strategy", equalRows, bankroll, { sim: eSim, allocPct: strategyAllocations["Equal Stake"] });
        const yCard = renderStrategy("YOLO Strategy", yoloRows, bankroll, { warn: "Warning: extreme risk — 100% bankroll on single parlay.", sim: ySim, allocPct: strategyAllocations.YOLO });
        resultsContainer.appendChild(sCard.card);
        resultsContainer.appendChild(kCard.card);
        resultsContainer.appendChild(eCard.card);
        resultsContainer.appendChild(yCard.card);
        // Change: remove auto confetti to preserve professional, math-first UX
        [sCard.card, kCard.card, eCard.card, yCard.card].forEach((c, i) => {
          c.classList.add("opacity-0", "animate-slide-in");
          c.style.animationDelay = `${i * 100}ms`;
        });
        initTilt(".strategy-card");
        renderRiskSummary([
          { name: "Singles", metrics: sCard.metrics, sim: sCard.sim },
          { name: "Kelly", metrics: kCard.metrics, sim: kCard.sim },
          { name: "Equal Stake", metrics: eCard.metrics, sim: eCard.sim },
          { name: "YOLO", metrics: yCard.metrics, sim: yCard.sim },
        ]);
        lastStrategies = [
          { name: "Kelly", rows: kellyRows },
          { name: "Equal Stake", rows: equalRows },
          { name: "YOLO", rows: yoloRows },
          { name: "Singles", rows: singlesRows },
        ];
        exportBtn.disabled = false;
        exportBtn.title = "Export current strategies as PDF";
        calcBtn.disabled = false;
        calcBtn.classList.remove("opacity-50", "cursor-wait");
        attachAllocationInputs(bankroll, truncWarnMsg);
        logPerformance("UI Rendering & Charting", renderStartTime);
      }

      window.runUFCPerformanceAudit = async () => {
        console.log("🚀 Starting Performance Audit...");
        const auditStart = performance.now();
        
        // 1. Setup high-load scenario (5 fights)
        const fcEl = document.getElementById("fightCount");
        if (fcEl) {
          fcEl.value = 5;
          fcEl.dispatchEvent(new Event('change'));
        }
        
        // 2. Fill with dummy data
        const names = ["Jon Jones", "Stipe Miocic", "Alex Pereira", "Khalil Rountree", "Islam Makhachev", "Arman Tsarukyan", "Sean O'Malley", "Merab Dvalishvili", "Max Holloway", "Ilia Topuria"];
        const cards = document.querySelectorAll('#fightsContainer .fight-card');
        cards.forEach((card, i) => {
          const inputs = card.querySelectorAll('.fighter-name');
          const odds = card.querySelectorAll('.fighter-odds');
          const confs = card.querySelectorAll('.fighter-confidence');
          if (inputs[0]) inputs[0].value = names[i*2] || "Fighter A";
          if (inputs[1]) inputs[1].value = names[i*2+1] || "Fighter B";
          if (odds[0]) odds[0].value = "1.91";
          if (odds[1]) odds[1].value = "1.91";
          if (confs[0]) confs[0].value = "60";
          if (confs[1]) confs[1].value = "60";
          inputs[0].dispatchEvent(new Event('input'));
          inputs[1].dispatchEvent(new Event('input'));
        });
        
        // 3. Trigger Calculation with MC
        const mcToggle = document.getElementById("mcToggle");
        if (mcToggle) mcToggle.checked = true;
        
        console.log("📊 Triggering 40,000 trial parallel simulation (High Load)...");
        await calculate();
        
        const totalTime = (performance.now() - auditStart).toFixed(2);
        let mem = "N/A";
        if (performance.memory) {
            mem = `${(performance.memory.usedJSHeapSize / (1024*1024)).toFixed(2)} MB`;
        }
        
        console.log("-----------------------------------------");
        console.log(`✅ Performance Audit Complete!`);
        console.log(`⏱️ Total Execution Time: ${totalTime}ms`);
        console.log(`🧠 Heap Memory Used: ${mem}`);
        console.log(`🧵 Workers in Pool: ${mcWorkerPool.length}`);
        console.log(`📈 Fights Simulated: 5 (2^5 = 32 parlay combinations per strategy)`);
        console.log("-----------------------------------------");
        
        return { totalTime, memory: mem };
      };

      let allocDebounceTimer = null;
      function attachAllocationInputs(bankroll, truncWarnMsg) {
        const inputs = resultsContainer.querySelectorAll('input[data-alloc]');
        inputs.forEach((inp) => {
          inp.addEventListener('input', () => {
            const key = inp.getAttribute('data-alloc');
            const val = parseInt(inp.value, 10);
            
            // Update local state immediately
            if (key === "Fractional Kelly (Minimum Risk)") strategyAllocations.Kelly = val;
            else if (key === "Equal Stake Strategy") strategyAllocations["Equal Stake"] = val;
            else if (key === "YOLO Strategy") strategyAllocations.YOLO = val;
            else if (key === "Single Bets (Kelly-optimized)") strategyAllocations.Singles = val;
            
            // Update the display text next to the slider immediately
            const valSpan = inp.nextElementSibling;
            if (valSpan) valSpan.textContent = `${val}%`;

            // Debounce the heavy UI re-render and simulation
            if (allocDebounceTimer) clearTimeout(allocDebounceTimer);
            allocDebounceTimer = setTimeout(async () => {
              if (lastStrategies) {
                const startTime = performance.now();
                const mcOn = document.getElementById("mcToggle")?.checked;
                const fights = readFights();
                
                let kSim, eSim, ySim, sSim;
                
                if (mcOn) {
                  if (loadingMsg) loadingMsg.textContent = "Updating Monte Carlo…";
                  const trials = 10000;
                  const totalTrials = trials * 4;
                  let completedTrials = 0;
                  let lastProgressUpdate = 0;
                  const updateProgress = (newDone) => {
                    completedTrials += newDone;
                    const now = performance.now();
                    if (now - lastProgressUpdate < 100 && completedTrials < totalTrials) return;
                    lastProgressUpdate = now;

                    const progress = Math.min(100, Math.round((completedTrials / totalTrials) * 100));
            const loadingBar = document.getElementById("loadingBar");
            const loadingPct = document.getElementById("loadingPct");
            const progressContainer = document.getElementById("progressBarContainer");
            if (loadingBar) loadingBar.style.width = `${progress}%`;
            if (loadingPct) loadingPct.textContent = `${progress}%`;
            if (progressContainer) progressContainer.setAttribute("aria-valuenow", progress);
                  };

                  const loadingWrap = document.getElementById("loadingWrap");
                  if (loadingWrap) loadingWrap.classList.remove("hidden");

                  [kSim, eSim, ySim, sSim] = await Promise.all([
                    runMonteCarloAsync(fights, getScaledRows(lastStrategies[0].rows, strategyAllocations.Kelly), bankroll, trials, updateProgress),
                    runMonteCarloAsync(fights, getScaledRows(lastStrategies[1].rows, strategyAllocations["Equal Stake"]), bankroll, trials, updateProgress),
                    runMonteCarloAsync(fights, getScaledRows(lastStrategies[2].rows, strategyAllocations.YOLO), bankroll, trials, updateProgress),
                    runMonteCarloAsync(fights, getScaledRows(lastStrategies[3].rows, strategyAllocations.Singles), bankroll, trials, updateProgress)
                  ]);

                  if (loadingWrap) loadingWrap.classList.add("hidden");
                }

                destroyChartsInContainer(resultsContainer);
                resultsContainer.innerHTML = "";
                
                const kCard = renderStrategy("Fractional Kelly (Minimum Risk)", lastStrategies[0].rows, bankroll, { truncationWarn: truncWarnMsg, allocPct: strategyAllocations.Kelly, sim: kSim });
                const eCard = renderStrategy("Equal Stake Strategy", lastStrategies[1].rows, bankroll, { allocPct: strategyAllocations["Equal Stake"], sim: eSim });
                const yCard = renderStrategy("YOLO Strategy", lastStrategies[2].rows, bankroll, { warn: "Warning: extreme risk — 100% bankroll on single parlay.", allocPct: strategyAllocations.YOLO, sim: ySim });
                const sCard = renderStrategy("Single Bets (Kelly-optimized)", lastStrategies[3].rows, bankroll, { allocPct: strategyAllocations.Singles, sim: sSim });
                
                resultsContainer.appendChild(kCard.card);
                resultsContainer.appendChild(eCard.card);
                resultsContainer.appendChild(yCard.card);
                resultsContainer.appendChild(sCard.card);
                
                renderRiskSummary([
                  { name: "Kelly", metrics: kCard.metrics, sim: kCard.sim },
                  { name: "Equal Stake", metrics: eCard.metrics, sim: eCard.sim },
                  { name: "YOLO", metrics: yCard.metrics, sim: yCard.sim },
                  { name: "Singles", metrics: sCard.metrics, sim: sCard.sim },
                ]);
                
                attachAllocationInputs(bankroll, truncWarnMsg);
                if (loadingMsg) loadingMsg.textContent = "";
                logPerformance("Slider Re-render", startTime);
              }
            }, 300);
          });
        });
      }
      async function runMonteCarloAsync(fights, rows, bankroll, totalTrials, onProgress) {
        let allResults = [];
        let done = 0;
        const chunk = 2500; 

        while (done < totalTrials) {
          const res = await runMonteCarloInWorker(fights, rows, bankroll, chunk);
          if (res.results) {
            allResults = allResults.concat(res.results);
          }
          
          done += chunk;
          if (typeof onProgress === 'function') onProgress(chunk);

          // Breathe to keep UI responsive
          await new Promise((resolve) => setTimeout(resolve, 0));
        }

        // Calculate final stats on the complete set
        allResults.sort((a, b) => a - b);
        const q = (p) => allResults[Math.floor(p * (allResults.length - 1))];
        
        return {
          median: q(0.5),
          p5: q(0.05),
          p95: q(0.95),
          drawdownProb: allResults.filter(x => x < -0.3 * bankroll).length / allResults.length,
          results: allResults
        };
      }
      fightCountEl.addEventListener("change", () => {
        if (!validateConfig()) return;
        buildFights();
      });

      buildBtn.addEventListener("click", () => {
        if (!validateConfig()) return;
        buildFights();
      });
      calcBtn.addEventListener("click", calculate);
      resetBtn.addEventListener("click", () => {
        fightCountEl.value = 3;
        bankrollEl.value = 1000;
        fightsContainer.innerHTML = "";
        destroyChartsInContainer(resultsContainer);
        resultsContainer.innerHTML = "";
        destroyChartsInContainer(riskSummary);
        riskSummary.innerHTML = "";
        calcBtn.disabled = true;
        calcBtn.classList.add("cursor-not-allowed");
        calcBtn.classList.remove("bg-red-600", "hover:bg-red-500");
        calcBtn.classList.add("bg-white/10");
        fightCountError.classList.add("hidden");
        bankrollError.classList.add("hidden");
        if (loadingMsg) loadingMsg.textContent = "";
        if (calcError) {
          calcError.textContent = "";
          calcError.classList.add("hidden");
        }
        exportBtn.disabled = true;
      });
      exportBtn.addEventListener("click", async () => {
        if (!lastStrategies) {
          if (calcError) {
            calcError.textContent = "Build fights and click Calculate Strategies before exporting.";
            calcError.classList.remove("hidden");
          }
          return;
        }
        // Simple Print/PDF export via browser
        window.print();
      });
      
      function applyOddsFormatToAllCards() {
          const label = document.getElementById("oddsFormatLabel");
          if (label) label.textContent = oddsFormatAmerican ? "American Odds" : "Decimal Odds";
          
          const allCards = fightsContainer.querySelectorAll(".fight-card > div, .rounded-xl.border.bg-white\\/5");
          fightsContainer.querySelectorAll(".odds-label").forEach(l => {
              l.textContent = oddsFormatAmerican ? "American Odds" : "Decimal Odds";
          });
          fightsContainer.querySelectorAll(".fighter-odds").forEach(inp => {
              const dec = parseOddsToDecimal(inp.value);
              if (Number.isFinite(dec) && dec > 1) {
                  inp.value = formatOddsDisplay(dec);
              } else {
                  inp.placeholder = oddsFormatAmerican ? (inp.placeholder.includes("2") ? "+110" : "-110") : (inp.placeholder.includes("2") ? "2.10" : "1.90");
              }
          });
      }
      
      const oddsToggle = document.getElementById("oddsFormatToggle");
      if (oddsToggle) {
          oddsToggle.addEventListener("change", (e) => {
              oddsFormatAmerican = e.target.checked;
              applyOddsFormatToAllCards();
              playClickSound();
          });
      }

      document.querySelectorAll('input[name="probMode"]').forEach(r => {
        r.addEventListener("change", () => {
          playSoftClickSound?.();
          const cards = document.querySelectorAll('#fightsContainer .rounded-2xl.w-full');
          cards.forEach(mainCard => {
            const s = getCurrentCardState(mainCard);
            if (typeof renderFightnomicsCalibration === "function") {
              renderFightnomicsCalibration(mainCard, s.statsA, s.statsB, s.oA, s.oB, s.cA, s.cB);
            }
            if (typeof attachCalibrationButtons === "function") attachCalibrationButtons(mainCard);
          });
          const calcB = document.getElementById("calcBtn");
          if (calcB && !calcB.disabled && typeof calculate === "function") {
            calculate();
          }
        });
      });

      /* ---------- Cross-IIFE shims: declare before creative + backend so they resolve at call time ---------- */
      let toast = function(...args) { if (typeof window.toast === "function") return window.toast(...args); };

      /* ---------- Creative front-end: live upcoming panel + avatars + share preview + dashboard upgrades ---------- */
      (function attachFrontendCreativeFeatures() {
        const BADGE = document.getElementById("liveOddsBadge");
        const PANEL = document.getElementById("upcomingPanel");
        const FEED = document.getElementById("upcomingFeed");
        const SKELETON = document.getElementById("upcomingSkeleton");
        const META = document.getElementById("upcomingMeta");
        const COUNT_BADGE = document.getElementById("upcomingCountBadge");
        const REFRESH_BTN = document.getElementById("refreshUpcomingBtn");
        const COLLAPSE_BTN = document.getElementById("collapseUpcomingBtn");
        const BODY = document.getElementById("upcomingBody");
        const DEFAULT_BASE = (typeof location !== "undefined" && location?.hostname === "localhost")
          ? `http://${location.hostname}:8787`
          : "http://localhost:8787";
        const BASE = (window.BACKEND_BASE_URL || DEFAULT_BASE).replace(/\/$/, "");
        function fetchJson(u, opts) { return fetch(u, opts).then(r => r.json().catch(() => null)).then(d => d); }
        function nameToHsl(name) {
          if (!name) return [0, 40, 20];
          let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
          return [h % 360, 45 + (h % 25), 18 + (h % 12)];
        }
        function nameGradient(name) {
          const [h, s, l] = nameToHsl(name);
          return `linear-gradient(135deg, hsl(${h} ${s}% ${l}%), hsl(${(h + 40) % 360} ${Math.min(80, s + 15)}% ${Math.min(38, l + 12)}%))`;
        }
        function initialsOf(name) {
          if (!name) return "?";
          const parts = name.split(/[\s,]+/).filter(Boolean);
          if (!parts.length) return "?";
          if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
          return (parts[0][0] + (parts[parts.length - 1][0] || "")).toUpperCase();
        }
        function setBadge(state) {
          if (!BADGE) return;
          BADGE.classList.remove("hidden");
          const dot = BADGE.querySelector("span:first-child");
          const text = BADGE.querySelector("span:last-child");
          if (!dot || !text) return;
          const map = {
            live:  { color: "bg-emerald-400 animate-pulse", border: "border-emerald-400/30", bg: "bg-emerald-500/10", text: "text-emerald-300", label: "LIVE · odds-api.io" },
            stub:  { color: "bg-amber-400",                border: "border-amber-500/30",   bg: "bg-amber-500/10",  text: "text-amber-300",  label: "STUB · demo feed" },
            err:   { color: "bg-rose-400",                 border: "border-rose-500/30",    bg: "bg-rose-500/10",   text: "text-rose-300",   label: "Offline · check backend" },
          };
          const s = map[state] || map.err;
          BADGE.className = `hidden sm:inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider border ${s.border} ${s.bg} ${s.text}`;
          dot.className = `w-1.5 h-1.5 rounded-full ${s.color}`;
          text.textContent = s.label;
        }
        let UPCOMING_CACHE = null;
        function promoThemeColor(name) {
          const n = String(name || "").toLowerCase();
          if (n.includes("ufc"))   return { from: "from-red-600/40", to: "to-rose-900/20",  ring: "border-red-500/30",    tag: "bg-red-500/15 border-red-400/30 text-red-300" };
          if (n.includes("rizin")) return { from: "from-fuchsia-600/40", to: "to-purple-900/20", ring: "border-fuchsia-500/30", tag: "bg-fuchsia-500/15 border-fuchsia-400/30 text-fuchsia-300" };
          if (n.includes("one"))   return { from: "from-indigo-600/40", to: "to-blue-900/20",   ring: "border-indigo-500/30",  tag: "bg-indigo-500/15 border-indigo-400/30 text-indigo-300" };
          if (n.includes("bellator")) return { from: "from-orange-600/40", to: "to-amber-900/20", ring: "border-orange-500/30", tag: "bg-orange-500/15 border-orange-400/30 text-orange-300" };
          if (n.includes("pfl"))   return { from: "from-sky-600/40", to: "to-cyan-900/20",    ring: "border-sky-500/30",     tag: "bg-sky-500/15 border-sky-400/30 text-sky-300" };
          if (n.includes("lfa"))   return { from: "from-teal-600/40", to: "to-emerald-900/20", ring: "border-teal-500/30",    tag: "bg-teal-500/15 border-teal-400/30 text-teal-300" };
          return { from: "from-slate-600/40", to: "to-slate-900/20", ring: "border-slate-500/30", tag: "bg-slate-500/15 border-slate-400/30 text-slate-300" };
        }
        function formatDateShort(iso) {
          try {
            const d = new Date(iso);
            const now = new Date();
            const days = Math.ceil((d - now) / (1000 * 60 * 60 * 24));
            const dayPhrase = (days <= 0 ? "TODAY" : days === 1 ? "TOMORROW" : `IN ${days}D`);
            return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " · " + dayPhrase;
          } catch(_) { return iso; }
        }
        function populateFightsFromEvent(event, slotCount) {
          const fights = (event && Array.isArray(event.fights)) ? event.fights : [];
          if (!fights.length) return;
          const N = Math.min(slotCount || 1, fights.length);
          const pickHeadlinersFirst = (event.event || "").toLowerCase().includes("ufc") || (event.league && event.league.slug && String(event.league.slug).toLowerCase().includes("ufc"));
          let chosen;
          if (pickHeadlinersFirst && fights.length > N) {
            chosen = fights.slice(-N).slice();
            chosen.reverse();
          } else {
            chosen = fights.slice(0, N);
          }
          const fcInput = document.getElementById("fightCount");
          if (fcInput) { fcInput.value = String(N); fcInput.dispatchEvent(new Event("change", { bubbles: true })); }
          setTimeout(() => {
            const mainCards = document.querySelectorAll('#fightsContainer .rounded-2xl.w-full');
            if (!mainCards || !mainCards.length) return;
            let filled = 0;
            for (let i = 0; i < mainCards.length && filled < N; i++) {
              const f = chosen[i];
              if (!f) continue;
              let fA = null, fB = null, oddA = 0, oddB = 0;
              if (Array.isArray(f.fighters) && f.fighters.length >= 2) {
                if (typeof f.fighters[0] === "string") {
                  fA = { name: f.fighters[0] };
                  fB = { name: f.fighters[1] };
                  if (Array.isArray(f._odds) && f._odds.length === 2) {
                    oddA = Number(f._odds[0]) || 0; oddB = Number(f._odds[1]) || 0;
                  } else if (Array.isArray(f.decimalOdds) && f.decimalOdds.length === 2) {
                    oddA = Number(f.decimalOdds[0]) || 0; oddB = Number(f.decimalOdds[1]) || 0;
                  } else if (Array.isArray(f.market) && f.market.length === 2) {
                    oddA = Number(f.market[0]) || 0; oddB = Number(f.market[1]) || 0;
                  }
                } else {
                  fA = f.fighters[0] || {}; fB = f.fighters[1] || {};
                  oddA = Number(fA.decimalOdds) || Number(fA.odds) || 0;
                  oddB = Number(fB.decimalOdds) || Number(fB.odds) || 0;
                }
              } else { continue; }
              if (!fA.name || !fB.name) continue;
              const mc = mainCards[i];
              const names = mc.querySelectorAll(".fighter-name");
              const odds  = mc.querySelectorAll(".fighter-odds");
              const confs = mc.querySelectorAll(".fighter-confidence");
              if (names[0]) { 
                names[0].value = fA.name || ""; 
                const bioA = resolveFighterBio(fA.name);
                if (bioA && bioA.stats) names[0].dataset.fighterStats = JSON.stringify(bioA.stats);
                names[0].dispatchEvent(new Event("input", { bubbles: true })); 
                names[0].dispatchEvent(new Event("blur",  { bubbles: true })); 
              }
              if (names[1]) { 
                names[1].value = fB.name || ""; 
                const bioB = resolveFighterBio(fB.name);
                if (bioB && bioB.stats) names[1].dataset.fighterStats = JSON.stringify(bioB.stats);
                names[1].dispatchEvent(new Event("input", { bubbles: true })); 
                names[1].dispatchEvent(new Event("blur",  { bubbles: true })); 
              }
              if (odds[0] && oddA >= 1.01) { odds[0].value = oddA.toFixed(2); odds[0].dispatchEvent(new Event("blur", { bubbles: true })); }
              if (odds[1] && oddB >= 1.01) { odds[1].value = oddB.toFixed(2); odds[1].dispatchEvent(new Event("blur", { bubbles: true })); }
              [0,1].forEach(j => {
                const c = confs[j]; if (!c) return;
                const d = j === 0 ? oddA : oddB;
                if (d >= 1.01) {
                  const implied = 1 / d;
                  c.value = Math.max(50, Math.min(99, Math.round(implied * 100)));
                } else { c.value = 75; }
                c.dispatchEvent(new Event("input", { bubbles: true }));
              });
              filled++;
            }
            const calcBtn = document.getElementById("calcBtn");
            const vF = typeof validateConfig === "function" ? validateConfig() : true;
            if (calcBtn) calcBtn.disabled = !vF;
            if (filled > 0) {
              toast(`✅ Populated ${filled} fight${filled > 1 ? "s" : ""} from <b>${event.event || "upcoming card"}</b>.`);
              
              // Workflow: Smooth scroll to builder
              const configSection = document.querySelector('.lg\\:col-span-8 > .rounded-2xl.border.border-white\\/10');
              if (configSection) {
                configSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }

              // Visual: Flash effect on updated cards
              mainCards.forEach((mc, idx) => {
                if (idx < filled) {
                  mc.classList.add('ring-2', 'ring-anthropic-orange', 'ring-opacity-50', 'transition-all');
                  setTimeout(() => mc.classList.remove('ring-2', 'ring-anthropic-orange', 'ring-opacity-50'), 1500);
                }
              });
            }
          }, 300);
        }
        async function refreshUpcoming(opts) {
          if (!PANEL) return;
          if (SKELETON) SKELETON.classList.remove("hidden");
          if (FEED) FEED.classList.add("hidden");
          setBadge("live");
          try {
            const url = BASE + "/api/schedule/upcoming" + (opts?.bust ? "?_=" + Date.now() : "");
            const start = performance.now();
            const resp = await fetch(url, { method: "GET", headers: { "Accept": "application/json" } });
            const cacheHeader = resp.headers.get("X-Cache") || "";
            const data = await resp.json().catch(() => null);
            if (!resp.ok || !data || !Array.isArray(data.events)) throw new Error(data?.message || "upcoming fetch failed");
            const elapsed = (performance.now() - start) | 0;
            UPCOMING_CACHE = data.events;
            const events = data.events;
            setBadge(cacheHeader === "STUB" ? "stub" : "live");
            if (META) META.textContent = `${events.length} cards · ${events.reduce((a, e) => a + ((e.fights || []).length), 0)} fights · X-Cache: ${cacheHeader || "-"} · ${elapsed}ms · provider ${data.provider || "-"}`;
            if (COUNT_BADGE) { COUNT_BADGE.classList.remove("hidden"); COUNT_BADGE.textContent = String(events.length); }
            const CONFIG_CHIP = document.getElementById("oddsConfigChip");
            Promise.resolve().then(async () => {
              try {
                const cr = await fetch(BASE + "/api/schedule/config", { headers: { "Accept": "application/json" } });
                const cd = await cr.json().catch(() => null);
                if (cd && CONFIG_CHIP) {
                  const tag = cd.hasKey ? `📡 ${cd.provider || "odds"} · books: ${(cd.bookmakers||[]).join(", ")} · cache ${cd.cacheTtlSec || 180}s` : "⚠️ STUB FEED (set ODDS_API_KEY in backend/.env for live lines)";
                  CONFIG_CHIP.textContent = tag;
                  CONFIG_CHIP.classList.remove("opacity-70");
                  if (cd.hasKey) { CONFIG_CHIP.classList.remove("text-slate-500"); CONFIG_CHIP.classList.add("text-emerald-400"); }
                  else { CONFIG_CHIP.classList.add("text-amber-400"); CONFIG_CHIP.classList.remove("text-slate-500"); }
                }
              } catch(_) { if (CONFIG_CHIP) CONFIG_CHIP.textContent = "📡 odds feed: config unavailable (backend down)"; }
            });
            if (FEED) {
              if (!window.__UPCOMING_PINNED) window.__UPCOMING_PINNED = new Set();
              if (!window.__UPCOMING_HIDDEN) window.__UPCOMING_HIDDEN = new Set();
              const PIN_SET = window.__UPCOMING_PINNED;
              const HIDE_SET = window.__UPCOMING_HIDDEN;
              function resolveFighter(el) {
                if (el == null) return "TBD";
                if (typeof el === "string") return el;
                if (typeof el.name === "string") return el.name;
                return String(el);
              }
              function extractFightOdds(f) {
                let arr = [];
                if (!f) return arr;
                if (Array.isArray(f._odds) && f._odds.length === 2) arr = f._odds.slice();
                if (!arr.length && Array.isArray(f.decimalOdds) && f.decimalOdds.length === 2) arr = f.decimalOdds.slice();
                if (!arr.length && Array.isArray(f.market) && f.market.length === 2) arr = f.market.slice();
                if (!arr.length && Array.isArray(f.fighters) && f.fighters.length >= 2) {
                  const a = f.fighters[0], b = f.fighters[1];
                  let oA = 0, oB = 0;
                  if (a && typeof a === "object") { oA = Number(a.decimalOdds) || Number(a.odds) || 0; }
                  if (b && typeof b === "object") { oB = Number(b.decimalOdds) || Number(b.odds) || 0; }
                  if (oA >= 1.01 && oB >= 1.01) arr = [oA, oB];
                }
                if (arr.length === 2 && Number(arr[0]) >= 1.01 && Number(arr[1]) >= 1.01) {
                  return [Number(arr[0]), Number(arr[1])];
                }
                return [];
              }
              function tileUniqueKey(ev, idx) {
                if (ev.id) return String(ev.id);
                if (ev.event) return String(ev.event) + "::" + String(idx);
                return "idx::" + String(idx);
              }
              FEED.innerHTML = events.map((ev, idx) => {
                const fights = ev.fights || [];
                const totalFights = fights.length;
                const slots = Math.max(1, Math.min(5, totalFights));
                const t = promoThemeColor(ev.league || ev.event || "");
                const pickHeadliners = (ev.event || "").toLowerCase().includes("ufc") || (ev.league && ev.league.slug && String(ev.league.slug).toLowerCase().includes("ufc"));
                
                // Show ALL fights in the mapping, but hide them with CSS if not expanded
                const fHtml = fights.map((f, rowIdx) => {
                  const actualIdx = rowIdx;
                  const rawArr = (f.fighters || []);
                  const nRawA = rawArr[0];
                  const nRawB = rawArr[1];
                  const nA = resolveFighter(nRawA);
                  const nB = resolveFighter(nRawB);
                  const odds = extractFightOdds(f);
                  const oddA = odds[0] || 0;
                  const oddB = odds[1] || 0;
                  const fightEventId = f._eventId ? String(f._eventId) : "";
                  const key = `${idx}:${actualIdx}`;
                  const isSelected = upcomingSelected.has(key);
                  const isHidden = rowIdx >= 3;

                  const oddsHtml = (oddA >= 1.01 && oddB >= 1.01)
                    ? `<div class="flex items-center gap-2 text-[10px] font-mono text-slate-400"><span class="px-1.5 py-0.5 rounded-md bg-black/40 border border-white/5">${oddA.toFixed(2)}</span><span>vs</span><span class="px-1.5 py-0.5 rounded-md bg-black/40 border border-white/5">${oddB.toFixed(2)}</span></div>`
                    : `<div class="text-[10px] font-mono text-slate-500 italic" data-pending-odds="${fightEventId}">odds not posted yet</div>`;

                  return `<div class="upc-fight-row flex items-center justify-between gap-2 py-2 px-1.5 rounded-lg border border-transparent hover:border-white/10 hover:bg-white/5 transition-all cursor-pointer group ${isSelected ? "selected" : ""} ${isHidden ? "upc-more-fights hidden" : ""}" 
                          data-event-idx="${idx}" data-fight-idx="${actualIdx}" data-fa="${encodeURIComponent(nA)}" data-fb="${encodeURIComponent(nB)}"
                          role="checkbox" aria-checked="${isSelected}" aria-label="Select fight: ${nA} vs ${nB}">
                    <div class="flex items-center gap-3 min-w-0">
                      <div class="upc-selection-circle w-4 h-4 rounded-full border border-white/20 bg-black/20 shrink-0 flex items-center justify-center"></div>
                      <div class="flex -space-x-1.5 shrink-0">
                        <div class="w-6 h-6 rounded-full border border-slate-900 flex items-center justify-center text-[8px] font-black text-white/90" style="background:${nameGradient(nA)}">${initialsOf(nA)}</div>
                        <div class="w-6 h-6 rounded-full border border-slate-900 flex items-center justify-center text-[8px] font-black text-white/90" style="background:${nameGradient(nB)}">${initialsOf(nB)}</div>
                      </div>
                      <div class="min-w-0">
                        <div class="text-[11px] font-semibold text-slate-200 truncate max-w-[150px] sm:max-w-[180px]">${nA} <span class="text-slate-500">vs</span> ${nB}</div>
                        ${oddsHtml}
                      </div>
                    </div>
                    <button class="upc-populate-fight opacity-0 group-hover:opacity-100 transition-opacity text-[9px] font-bold uppercase tracking-widest text-anthropic-orange hover:text-white px-2 py-1 rounded-md bg-anthropic-orange/10 border border-anthropic-orange/30 shrink-0" data-event="${idx}" data-fight-idx="${actualIdx}" data-slot="1">Populate →</button>
                  </div>`;
                }).join("");

                const headliner = fights[fights.length - 1];
                const hOdds = extractFightOdds(headliner);
                let roiTag = "";
                if (hOdds.length === 2 && FN) {
                  const m = FN.removeVigFromOdds(hOdds[0], hOdds[1]);
                  const edge = Math.abs(m.probA - (1/hOdds[0]));
                  if (edge > 0.05) roiTag = `<span class="ml-2 text-[9px] font-black bg-anthropic-orange/20 text-anthropic-orange border border-anthropic-orange/30 px-1.5 py-0.5 rounded italic shadow-sm animate-pulse">High Edge</span>`;
                }

                const restN = Math.max(0, totalFights - 3);
                const uk = tileUniqueKey(ev, idx);
                const pinned = PIN_SET.has(uk);
                const hidden = HIDE_SET.has(uk);

                return `<div class="upc-tile relative rounded-xl bg-gradient-to-br ${t.from} ${t.to} border ${pinned ? "ring-2 ring-amber-400/60 " : ""}${t.ring} p-3.5 overflow-hidden flex flex-col hover:-translate-y-0.5 transition-all duration-200 hover:shadow-xl hover:shadow-red-950/40" data-event-idx="${idx}" data-tile-key="${uk}" data-pinned="${pinned ? "1" : "0"}" ${hidden ? 'style="display:none"' : ""}>
                  <div class="flex items-start justify-between gap-2 mb-2">
                    <div class="min-w-0">
                      <div class="flex items-center">
                        <div class="text-[10px] font-bold uppercase tracking-[0.15em] rounded-full px-2 py-0.5 inline-block ${t.tag}">${(ev.league && ev.league.name) || ev.event || "MMA"}</div>
                        ${roiTag}
                      </div>
                      <div class="mt-1.5 text-sm font-black text-white leading-tight line-clamp-2">${ev.event || "Event"}</div>
                    </div>
                    <div class="text-right shrink-0 flex flex-col items-end gap-1.5">
                      <div class="flex items-center gap-1">
                        <button type="button" class="upc-pin-btn rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${pinned ? "text-amber-200 bg-amber-500/20 border-amber-400/70 shadow-[0_0_20px_-5px_rgba(251,191,36,0.45)]" : "text-amber-300/90 hover:text-amber-200 border-amber-500/30 hover:border-amber-500/50 bg-amber-500/5 hover:bg-amber-500/10"} border transition-colors" data-tile-key="${uk}" title="Pin (Épingler) — keep tile at top" aria-label="Pin tile">📌 ${pinned ? "Épinglé" : "Pin"}</button>
                        <button type="button" class="upc-hide-btn rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-300/90 hover:text-slate-200 border border-white/10 hover:border-white/20 bg-white/5 hover:bg-white/10 transition-colors" data-tile-key="${uk}" title="Hide tile (undo available)" aria-label="Hide tile">✕ Hide</button>
                      </div>
                      <div class="text-[10px] font-bold uppercase tracking-wider text-white/70">${formatDateShort(ev.date)}</div>
                      <div class="text-[10px] font-mono text-white/60">${totalFights} Fights</div>
                    </div>
                  </div>
                  <div class="rounded-lg bg-black/35 border border-white/5 px-2.5 py-1.5 space-y-0.5">
                    ${fHtml || `<div class="text-[11px] italic text-slate-400 py-2 text-center">Fight card not finalized yet</div>`}
                    ${restN > 0 ? `<button class="upc-show-more-btn w-full text-[10px] font-mono text-slate-400 pt-1.5 pb-1 border-t border-white/5 hover:text-anthropic-orange transition-colors">+ ${restN} more fights (click to expand)</button>` : ""}
                  </div>
                  <div class="mt-3 flex items-center gap-1.5">
                    <button class="upc-populate flex-1 text-[11px] font-bold uppercase tracking-wider px-2.5 py-2 rounded-lg bg-white/10 hover:bg-white/15 border border-white/10 text-white transition-colors" data-event="${idx}" data-slots="${slots}">Populate ${slots} fight${slots === 1 ? "" : "s"} →</button>
                    <button class="upc-pop-live-btn rounded-lg px-2.5 py-2 text-[11px] font-bold uppercase tracking-wider bg-gradient-to-r from-emerald-600/30 to-cyan-600/30 hover:from-emerald-500/40 hover:to-cyan-500/40 border border-emerald-400/30 text-emerald-200 transition-colors shrink-0" data-event="${idx}" data-slots="${slots}" title="Populate + inject live market prices into Kelly engine">⚡ LIVE</button>
                    <button class="upc-viewodds rounded-lg px-2.5 py-2 text-[11px] font-bold uppercase tracking-wider bg-black/30 hover:bg-black/40 border border-white/5 text-slate-300 transition-colors" data-event="${idx}" title="Look up live odds for headline fight">Odds</button>
                  </div>
                </div>`;
              }).join("");
              FEED.classList.remove("hidden");
              function reorderTilesPinnedFirst() {
                if (!FEED) return;
                const all = Array.from(FEED.querySelectorAll(":scope > .upc-tile"));
                const sorted = all.slice().sort((a, b) => {
                  const pa = (a.dataset.pinned === "1") ? 1 : 0;
                  const pb = (b.dataset.pinned === "1") ? 1 : 0;
                  if (pa !== pb) return pb - pa;
                  const ia = Number(a.dataset.eventIdx ?? 0) || 0;
                  const ib = Number(b.dataset.eventIdx ?? 0) || 0;
                  return ia - ib;
                });
                let changed = false;
                all.forEach((n, i) => { if (n !== sorted[i]) changed = true; });
                if (!changed) return;
                const frag = document.createDocumentFragment();
                sorted.forEach(n => frag.appendChild(n));
                FEED.appendChild(frag);
              }
              setTimeout(reorderTilesPinnedFirst, 30);
              (async function hydrateHeadlinerOddsBackground() {
                try {
                  const HYDRATE_LOCK_KEY = "__odds_hydrate_last_run_ts";
                  const HYDRATE_LOCK_MS = 5 * 60 * 1000;
                  const now = Date.now();
                  const last = Number(window[HYDRATE_LOCK_KEY] || 0) || 0;
                  if (!opts?.bust && (now - last) < HYDRATE_LOCK_MS) return;
                  window[HYDRATE_LOCK_KEY] = now;
                  if (window.__ODDS_HYDRATE_ABORT) { try { window.__ODDS_HYDRATE_ABORT.abort(); } catch(_) {} }
                  const abort = new AbortController();
                  window.__ODDS_HYDRATE_ABORT = abort;
                  const targetRows = [];
                  events.forEach((ev, evIdx) => {
                    const league = String((ev.league && (ev.league.slug || ev.league.name)) || ev.event || "").toLowerCase();
                    const isTier = /ufc|bellator|rizin|one\s|pfl/.test(league);
                    if (!isTier && !/ufc/.test(league)) return;
                    const headliner = Array.isArray(ev.fights) && ev.fights.length ? ev.fights[ev.fights.length - 1] : null;
                    if (!headliner || !headliner._eventId) return;
                    targetRows.push({ evIdx, eventId: String(headliner._eventId), fighters: headliner.fighters });
                  });
                  if (!targetRows.length) return;
                  const localCache = window.__UPCOMING_ODDS_CACHE || new Map();
                  let inflight = 0;
                  let cursor = 0;
                  const LIMIT = 2;
                  function findRowDom(rec) {
                    if (!FEED) return null;
                    const tile = FEED.querySelector(`:scope > .upc-tile[data-event-idx="${rec.evIdx}"]`);
                    if (!tile) return null;
                    const fr = (rec.fighters || []).map(x => typeof x === "string" ? x : (x && x.name ? x.name : String(x || "")));
                    const rows = tile.querySelectorAll(":scope [data-row-eventid]");
                    for (const r of rows) {
                      if (r.dataset.rowEventid === rec.eventId) return r;
                      const fa = decodeURIComponent(r.dataset.rowFa || "");
                      const fb = decodeURIComponent(r.dataset.rowFb || "");
                      function norm(s){ return String(s || "").toLowerCase().replace(/[^a-z0-9]/g,""); }
                      if (fr.length === 2) {
                        const [A, B] = [norm(fr[0]), norm(fr[1])];
                        const [rA, rB] = [norm(fa), norm(fb)];
                        if ((rA && (A.includes(rA) || rA.includes(A))) && (rB && (B.includes(rB) || rB.includes(B)))) return r;
                      }
                    }
                    return rows[rows.length - 1] || null;
                  }
                  function injectOddsToRow(row, booksArr) {
                    if (!row) return;
                    const pen = row.querySelector(":scope [data-pending-odds]");
                    if (!Array.isArray(booksArr) || !booksArr.length) {
                      if (pen) { pen.textContent = "⏳ lines pending"; pen.classList.remove("italic"); pen.classList.add("text-slate-600"); }
                      return;
                    }
                    const chips = booksArr.slice(0, 2).map(bk => `<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-400/30 text-[10px] font-mono text-emerald-300"><b class="text-emerald-200">${bk.book || ""}</b> ${(bk.decOdds||[]).map(x=>(Number(x)||0).toFixed(2)).join(" / ")}</span>`).join("");
                    const liveTag = `<span class="text-[9px] text-emerald-500/80 uppercase tracking-wider font-bold px-1 rounded-sm bg-emerald-500/5 border border-emerald-400/20">LIVE</span>`;
                    const wrapper = document.createElement("div");
                    wrapper.className = "flex items-center gap-1 flex-wrap";
                    wrapper.innerHTML = chips + liveTag;
                    if (pen) pen.parentNode.replaceChild(wrapper, pen);
                    else {
                      const slot = row.querySelector(":scope .text-slate-400, :scope .text-slate-500");
                      if (slot) slot.insertAdjacentElement("afterend", wrapper);
                    }
                  }
                  async function runOne(rec) {
                    try {
                      const ck = "od:" + rec.eventId;
                      let d = localCache.get(ck);
                      if (!d || !d._ts || (now - d._ts) >= 180000) {
                        if (abort.signal.aborted) return;
                        const resp = await fetch(BASE + "/api/schedule/odds/" + encodeURIComponent(rec.eventId), { signal: abort.signal, headers: { "Accept": "application/json" } });
                        d = await resp.json().catch(() => null);
                        if (d && typeof d === "object") { d._ts = Date.now(); localCache.set(ck, d); window.__UPCOMING_ODDS_CACHE = localCache; }
                      }
                      const m0 = (d && Array.isArray(d.markets)) ? d.markets[0] : null;
                      const books = (m0 && Array.isArray(m0.books)) ? m0.books : [];
                      const row = findRowDom(rec);
                      injectOddsToRow(row, books);
                    } catch (e) { if (e && e.name !== "AbortError") {} }
                  }
                  function pump() {
                    if (abort.signal.aborted) return;
                    while (cursor < targetRows.length && inflight < LIMIT) {
                      inflight++;
                      const rec = targetRows[cursor++];
                      runOne(rec).finally(() => { inflight--; pump(); });
                    }
                  }
                  pump();
                } catch (_) {}
              })();

              FEED.querySelectorAll(".upc-pin-btn").forEach(b => b.addEventListener("click", (ev) => {
                ev.preventDefault(); ev.stopPropagation();
                const uk = String(b.dataset.tileKey || "");
                if (!uk) return;
                const tile = b.closest(".upc-tile");
                const wasPinned = PIN_SET.has(uk);
                const next = !wasPinned;
                if (next) PIN_SET.add(uk); else PIN_SET.delete(uk);
                if (tile) {
                  tile.dataset.pinned = next ? "1" : "0";
                  tile.classList.toggle("ring-2", next);
                  tile.classList.toggle("ring-amber-400/60", next);
                }
                b.classList.toggle("text-amber-200", next);
                b.classList.toggle("bg-amber-500/20", next);
                b.classList.toggle("border-amber-400/70", next);
                b.classList.toggle("shadow-[0_0_20px_-5px_rgba(251,191,36,0.45)]", next);
                b.classList.toggle("text-amber-300/90", !next);
                b.classList.toggle("bg-amber-500/5", !next);
                b.classList.toggle("border-amber-500/30", !next);
                b.textContent = next ? "📌 Épinglé" : "📌 Pin";
                if (typeof playSoftClickSound === "function") playSoftClickSound();
                reorderTilesPinnedFirst();
                if (next && typeof window.toast === "function") {
                  const tileName = (tile && tile.querySelector(".font-black")) ? tile.querySelector(".font-black").textContent.trim() : ("Tile #" + ((tile && tile.dataset.eventIdx) ? tile.dataset.eventIdx : ""));
                  toast(`📍 Pinned · <b>${tileName}</b>`);
                }
              }));
              FEED.querySelectorAll(".upc-hide-btn").forEach(b => b.addEventListener("click", (ev) => {
                ev.preventDefault(); ev.stopPropagation();
                const uk = String(b.dataset.tileKey || "");
                if (!uk) return;
                const tile = b.closest(".upc-tile");
                if (!tile) return;
                let undoTimer = null, deadlineTimer = null, alreadyHidden = HIDE_SET.has(uk);
                const tileName = (tile.querySelector(".font-black")) ? tile.querySelector(".font-black").textContent.trim() : ("Card #" + (tile.dataset.eventIdx || ""));
                if (alreadyHidden) {
                  HIDE_SET.delete(uk);
                  tile.style.display = "";
                  requestAnimationFrame(() => { tile.style.opacity = ""; tile.style.transform = ""; });
                  if (typeof playSoftClickSound === "function") playSoftClickSound();
                  return;
                }
                HIDE_SET.add(uk);
                tile.style.opacity = "0";
                tile.style.transform = "translateY(-4px) scale(0.985)";
                undoTimer = setTimeout(() => { if (HIDE_SET.has(uk)) { tile.style.display = "none"; reorderTilesPinnedFirst(); } }, 400);
                if (typeof playSoftClickSound === "function") playSoftClickSound();
                const toastHost = (typeof window.toast === "function");
                let toastBox = null;
                const toastId = "uhide-" + String(Math.random()).slice(2, 8);
                if (toastHost) window.toast(`<div data-upc-toast-hide="${toastId}" class="flex items-center gap-3"><div class="flex-1"><div class="font-semibold text-slate-200">🗂️ Schedule tile hidden</div><div class="text-[11px] font-mono text-slate-400 mt-0.5">${tileName}</div></div><button type="button" class="upc-hide-undo shrink-0 rounded-md px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-200 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40">↶ Undo (10s)</button></div>`);
                function undoNow() {
                  if (undoTimer) { clearTimeout(undoTimer); undoTimer = null; }
                  if (deadlineTimer) { clearTimeout(deadlineTimer); deadlineTimer = null; }
                  HIDE_SET.delete(uk);
                  tile.style.display = "";
                  requestAnimationFrame(() => { tile.style.opacity = ""; tile.style.transform = ""; reorderTilesPinnedFirst(); });
                  if (toastBox && toastBox.parentNode) try { toastBox.parentNode.removeChild(toastBox); } catch (_) {}
                }
                setTimeout(() => {
                  try {
                    const box = document.querySelector(`[data-upc-toast-hide="${toastId}"]`);
                    if (!box) return;
                    toastBox = box.closest(".toast, .toast-wrap, [class*=toast]") || box;
                    const u = box.querySelector(".upc-hide-undo");
                    if (u) u.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); undoNow(); });
                  } catch (_) { /* ignore */ }
                }, 50);
                deadlineTimer = setTimeout(() => { deadlineTimer = null; if (HIDE_SET.has(uk)) { tile.style.display = "none"; reorderTilesPinnedFirst(); } }, 10000);
              }));
              setTimeout(reorderTilesPinnedFirst, 30);

              FEED.querySelectorAll(".upc-show-more-btn").forEach(b => b.addEventListener("click", () => {
                const tile = b.closest(".upc-tile");
                if (tile) tile.classList.add("upc-tile-expanded");
              }));

              FEED.querySelectorAll(".upc-fight-row").forEach(row => row.addEventListener("click", (e) => {
                if (e.target.closest(".upc-populate-fight")) return;
                const evIdx = Number(row.dataset.eventIdx);
                const fIdx = Number(row.dataset.fightIdx);
                const evObj = events[evIdx];
                const fObj = evObj.fights[fIdx];
                toggleUpcomingFightSelection(evIdx, fIdx, fObj, evObj, row);
              }));

              const clearBtn = document.getElementById("upcClearSelection");
              if (clearBtn) {
                  clearBtn.onclick = clearUpcomingSelection;
              }
              const buildSelBtn = document.getElementById("upcBuildSelected");
              if (buildSelBtn) {
                  buildSelBtn.onclick = buildFromSelected;
              }

              FEED.querySelectorAll(".upc-populate").forEach(b => b.addEventListener("click", () => {
                const ev = UPCOMING_CACHE[Number(b.dataset.event)];
                populateFightsFromEvent(ev, Number(b.dataset.slots) || 1);
                if (typeof playSoftClickSound === "function") playSoftClickSound();
                document.getElementById("fightsContainer")?.scrollIntoView({ behavior: "smooth", block: "start" });
              }));
              FEED.querySelectorAll(".upc-viewodds").forEach(b => b.addEventListener("click", async () => {
                const ev = UPCOMING_CACHE[Number(b.dataset.event)];
                const allFights = (ev && Array.isArray(ev.fights)) ? ev.fights.slice() : [];
                if (!allFights.length) { toast("ℹ️ No fights scheduled yet — check back closer to fight night."); return; }
                const pickHeadlinersFirst = (ev.event || "").toLowerCase().includes("ufc")
                  || (ev.league && ev.league.slug && String(ev.league.slug).toLowerCase().includes("ufc"));
                const ordered = pickHeadlinersFirst ? allFights.slice().reverse() : allFights.slice();
                function inlineLinesOf(fight) {
                  if (!fight) return null;
                  let arr = [];
                  if (Array.isArray(fight._odds) && fight._odds.length === 2) arr = fight._odds;
                  if (Array.isArray(fight.decimalOdds) && fight.decimalOdds.length === 2) arr = fight.decimalOdds;
                  if (Array.isArray(fight.market) && fight.market.length === 2) arr = fight.market;
                  if (!arr.length && Array.isArray(fight.fighters)) {
                    const f0Obj = fight.fighters[0], f1Obj = fight.fighters[1];
                    const oA = Number(f0Obj?.decimalOdds || f0Obj?.odds || 0) || 0;
                    const oB = Number(f1Obj?.decimalOdds || f1Obj?.odds || 0) || 0;
                    if (oA >= 1.01 && oB >= 1.01) arr = [oA, oB];
                  }
                  if (arr.length === 2 && Number(arr[0]) >= 1.01 && Number(arr[1]) >= 1.01) {
                    return {
                      oA: Number(arr[0]).toFixed(2),
                      oB: Number(arr[1]).toFixed(2),
                      names: Array.isArray(fight.fighters) ? fight.fighters.map(n => typeof n === "string" ? n : (n && n.name || "TBD")) : ["TBD A","TBD B"]
                    };
                  }
                  return null;
                }
                function renderInlineChip(inline, fallback) {
                  const names = inline.names && inline.names.join(" vs ");
                  return `<span class="inline-flex items-center gap-1 mr-2 mb-1 px-1.5 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/30 text-[10px] font-mono text-amber-200"><b class="text-amber-100">${fallback || "Event Feed"}</b> ${inline.oA} / ${inline.oB}</span><span class="text-slate-500 text-[10px] block mt-1">${names} · lines visible on card above</span>`;
                }
                if (!window.__UPCOMING_ODDS_CACHE) window.__UPCOMING_ODDS_CACHE = new Map();
                const ODDS_CACHE = window.__UPCOMING_ODDS_CACHE;
                let fallbackInlineFirst = null;
                for (const fScan of ordered) { if (!fallbackInlineFirst && inlineLinesOf(fScan)) { fallbackInlineFirst = inlineLinesOf(fScan); break; } }
                let best = null;
                for (const fightTry of ordered) {
                  if (!fightTry._eventId) continue;
                  const ck = "od:" + String(fightTry._eventId);
                  const fromCache = ODDS_CACHE.get(ck) || null;
                  let resp = null, d = null, m = null, books = [];
                  try {
                    if (fromCache && fromCache._ts && Date.now() - fromCache._ts < 180000) {
                      resp = { ok: true, headers: { get: () => "LIVE·CACHE" } };
                      d = fromCache;
                    } else {
                      resp = await fetch(BASE + "/api/schedule/odds/" + encodeURIComponent(fightTry._eventId));
                      d = await resp.json().catch(() => null);
                      if (resp.ok && d && typeof d === "object") {
                        d._ts = Date.now();
                        ODDS_CACHE.set(ck, d);
                      }
                    }
                    m = Array.isArray(d?.markets) ? d.markets[0] : null;
                    books = (m && Array.isArray(m.books)) ? m.books.slice() : [];
                    const inlineCur = inlineLinesOf(fightTry);
                    if (!books.length && inlineCur) {
                      best = { kind: "inline", fighters: inlineCur.names.join(" vs "), inlineCur: inlineCur };
                      break;
                    }
                    if (books.length) {
                      const fightersTxt = (m && Array.isArray(m.fighters))
                        ? m.fighters.map(x => x.name).join(" vs ")
                        : ((inlineCur && inlineCur.names.join(" vs ")) || ev.event || "");
                      const xcHeader = resp && resp.headers && typeof resp.headers.get === "function" ? (resp.headers.get("X-Cache") || "") : "";
                      best = { kind: "books", fighters: fightersTxt, books: books, note: (m && m._note) ? m._note : "", xcache: xcHeader };
                      break;
                    }
                  } catch (e) {
                    const isLast = (ordered.indexOf(fightTry) === ordered.length - 1);
                    if (isLast) {
                      toast(`<span class="text-red-300">❌ ${e.message}</span>`);
                      return;
                    }
                  }
                }
                if (!best && fallbackInlineFirst) {
                  toast(`📊 <b>${fallbackInlineFirst.names.join(" vs ")}</b> live · HEADLINER<br>${renderInlineChip(fallbackInlineFirst, "Stake Feed")}`);
                  return;
                }
                if (best && best.kind === "inline") {
                  toast(`📊 <b>${best.fighters}</b> live · HEADLINER<br>${renderInlineChip(best.inlineCur, "Stake Feed")}<span class="text-slate-500 text-[10px] block mt-1">· No per-bookmaker breakdown posted yet · check back closer to fight night · main lines already visible on feed</span>`);
                  return;
                }
                if (best && best.kind === "books") {
                  let bestA = 1, bestB = 1, bestABook = "-", bestBBook = "-";
                  for (const bk of best.books) {
                    const [dA, dB] = [Number((bk.decOdds||[])[0]) || 1, Number((bk.decOdds||[])[1]) || 1];
                    if (dA > bestA) { bestA = dA; bestABook = bk.book || "-"; }
                    if (dB > bestB) { bestB = dB; bestBBook = bk.book || "-"; }
                  }
                  const vigSum = (bestA > 1 && bestB > 1) ? (1/bestA + 1/bestB) : 1;
                  const isArb = (bestA > 1 && bestB > 1 && vigSum < 0.995);
                  const vigPct = (vigSum - 1) * 100;
                  const chipStr = best.books.map(bk => {
                    const [dA, dB] = [Number((bk.decOdds||[])[0]) || 0, Number((bk.decOdds||[])[1]) || 0];
                    const hiA = dA >= 1.01 && dA === bestA;
                    const hiB = dB >= 1.01 && dB === bestB;
                    const clsA = hiA ? "text-emerald-200 font-bold bg-emerald-500/20" : "text-slate-300";
                    const clsB = hiB ? "text-cyan-200 font-bold bg-cyan-500/20" : "text-slate-300";
                    return `<span class="inline-flex items-center gap-1 mr-2 mb-1 px-1.5 py-0.5 rounded-md bg-black/40 border border-white/5 text-[10px] font-mono text-slate-300"><b class="text-slate-100">${bk.book || "-"}</b> <span class="px-1 rounded ${clsA}">${dA ? dA.toFixed(2) : "-"}</span>/<span class="px-1 rounded ${clsB}">${dB ? dB.toFixed(2) : "-"}</span></span>`;
                  }).join("");
                  const noteHtml = best.note ? `<span class="text-slate-500 text-[10px] block mt-1">${best.note}</span>` : "";
                  const arbHtml = isArb
                    ? `<div class="mt-1 rounded-md bg-emerald-500/15 border border-emerald-400/50 px-2 py-1 text-[10px] font-mono text-emerald-300"><b>🟢 ARBITRAGE</b> · implied vig ${(vigSum*100).toFixed(1)}% (guaranteed profit)</div>`
                    : (bestA > 1 && bestB > 1 ? `<div class="mt-1 text-[10px] font-mono text-slate-400 flex items-center gap-3 flex-wrap"><span>BEST LINE: <b class="text-emerald-200">${bestABook}</b> ${bestA.toFixed(2)} / <b class="text-cyan-200">${bestBBook}</b> ${bestB.toFixed(2)}</span><span>·</span><span>market vig <b class="${vigPct < 3 ? 'text-slate-300' : 'text-amber-300'}">${vigPct >= 0 ? '+' : ''}${vigPct.toFixed(1)}%</b></span></div>` : "");
                  toast(`📊 <b>${best.fighters}</b> live odds · ${best.xcache || ""}<br>${chipStr || "(Waiting per-book lines)"}${arbHtml}${noteHtml}`);
                  return;
                }
                const extra = fallbackInlineFirst ? ` · ${fallbackInlineFirst.names.join(" vs ")} visible on feed` : "";
                toast(`ℹ️ No bookmakers posted yet · main event lines not live${extra}.`);
              }));
              FEED.querySelectorAll(".upc-populate-fight").forEach(b => b.addEventListener("click", () => {
                const ev = UPCOMING_CACHE[Number(b.dataset.event)];
                if (!ev || !Array.isArray(ev.fights)) return;
                const fIdx = Number(b.dataset.fightIdx) || 0;
                populateFightsFromEvent({ fights: [ev.fights[fIdx]] }, 1);
                if (typeof playSoftClickSound === "function") playSoftClickSound();
                document.getElementById("fightsContainer")?.scrollIntoView({ behavior: "smooth", block: "start" });
              }));
              FEED.querySelectorAll(".upc-pop-live-btn").forEach(b => b.addEventListener("click", async () => {
                const ev = UPCOMING_CACHE[Number(b.dataset.event)];
                const slotCount = Number(b.dataset.slots) || 1;
                if (!ev || !Array.isArray(ev.fights)) return;
                window.__SAVED_LIVE_SOURCE = { type: "live-odds", at: new Date().toISOString(), provider: (typeof window.__scheduleConfig?.oddsProvider === "string") ? window.__scheduleConfig.oddsProvider : ((await (async () => { try { const c = await fetch(BASE + "/api/schedule/config").then(r => r.json()).catch(() => null); return c?.provider || "odds-api"; } catch(_) { return "odds-api"; } })())), eventId: String(ev._id || ev.id || ""), eventLabel: String(ev.event || ev.name || "") };
                if (typeof playSoftClickSound === "function") playSoftClickSound();
                const marketRadio = document.querySelector('input[name="probMode"][value="market"]');
                if (marketRadio) { marketRadio.checked = true; marketRadio.dispatchEvent(new Event("change", { bubbles: true })); }
                populateFightsFromEvent(ev, slotCount);
                toast(`⚡ LIVE mode · populating ${slotCount} fight${slotCount===1?"":"s"} + fetching market lines…`);
                document.getElementById("fightsContainer")?.scrollIntoView({ behavior: "smooth", block: "start" });
                setTimeout(async () => {
                  try {
                    const fights = ev.fights || [];
                    const pickHeadlinersFirst = (ev.event || "").toLowerCase().includes("ufc")
                      || (ev.league && ev.league.slug && String(ev.league.slug).toLowerCase().includes("ufc"));
                    const chosen = pickHeadlinersFirst && fights.length > slotCount
                      ? fights.slice(-slotCount).slice().reverse()
                      : fights.slice(0, slotCount);
                    const mainCards = Array.from(document.querySelectorAll('#fightsContainer .rounded-2xl.w-full'));
                    for (let ci = 0; ci < Math.min(chosen.length, mainCards.length); ci++) {
                      const f = chosen[ci]; if (!f || !f._eventId) continue;
                      const eventId = String(f._eventId);
                      const [frA, frB] = Array.isArray(f.fighters) ? f.fighters : ["", ""];
                      const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g,"");
                      const wantA = norm(typeof frA === "string" ? frA : frA?.name || "");
                      const wantB = norm(typeof frB === "string" ? frB : frB?.name || "");
                      let oddsResp = null;
                      try {
                        const cache = window.__UPCOMING_ODDS_CACHE || new Map();
                        const ck = "od:" + eventId;
                        const cached = cache.get(ck);
                        if (cached && cached._ts && Date.now() - cached._ts < 180000) oddsResp = cached;
                        else {
                          const r = await fetch(BASE + "/api/schedule/odds/" + encodeURIComponent(eventId), { headers: { "Accept": "application/json" } });
                          oddsResp = await r.json().catch(() => null);
                          if (oddsResp && typeof oddsResp === "object") { oddsResp._ts = Date.now(); cache.set(ck, oddsResp); window.__UPCOMING_ODDS_CACHE = cache; }
                        }
                      } catch(_) { oddsResp = null; }
                      const m0 = (oddsResp && Array.isArray(oddsResp.markets)) ? oddsResp.markets[0] : null;
                      const books = (m0 && Array.isArray(m0.books)) ? m0.books : [];
                      if (!books.length) continue;
                      let bestA = 0, bestB = 0;
                      for (const bk of books) {
                        const [dA, dB] = [Number((bk.decOdds||[])[0]) || 0, Number((bk.decOdds||[])[1]) || 0];
                        if (dA > bestA) bestA = dA; if (dB > bestB) bestB = dB;
                      }
                      if (!(bestA >= 1.01 && bestB >= 1.01)) continue;
                      const mc = mainCards[ci];
                      const nameEls = mc.querySelectorAll(".fighter-name");
                      const oddsEls = mc.querySelectorAll(".fighter-odds");
                      const nA = norm(nameEls?.[0]?.value || "");
                      const nB = norm(nameEls?.[1]?.value || "");
                      const swap = (wantA && nB && wantA.includes(nB)) || (wantB && nA && wantB.includes(nA));
                      const apply = swap ? [bestB, bestA] : [bestA, bestB];
                      for (let j = 0; j < 2; j++) {
                        const oEl = oddsEls?.[j]; if (!oEl) continue;
                        oEl.value = Number(apply[j]).toFixed(2);
                        oEl.dispatchEvent(new Event("blur", { bubbles: true }));
                      }
                    }
                    toast(`✅ LIVE prices injected · Probability Drive = <b>Market No-Vig</b> · Kelly re-computed.`);
                  } catch (e) { toast(`⚠️ LIVE odds incomplete: ${e.message}`); }
                }, 450);
              }));
            }
            if (SKELETON) SKELETON.classList.add("hidden");
          } catch(err) {
            setBadge("err");
            if (META) META.textContent = "⚠️ " + (err.message || "failed");
            if (SKELETON) SKELETON.classList.add("hidden");
            if (FEED) {
              FEED.classList.remove("hidden");
              FEED.innerHTML = `<div class="rounded-xl border border-rose-500/30 bg-rose-500/5 p-5 text-center">
                <div class="text-rose-300 font-bold">Couldn't reach live odds backend</div>
                <div class="text-[11px] text-slate-400 mt-1 font-mono">Start backend: cd backend && npm install && npm run dev</div>
                <div class="text-[11px] text-slate-500 mt-2">${err.message}</div>
                <button class="mt-3 rounded-lg px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider bg-white/10 hover:bg-white/15 border border-white/10 text-slate-100 transition-colors" id="upcomingRetry">Retry</button>
              </div>`;
              const r = document.getElementById("upcomingRetry");
              if (r) r.addEventListener("click", () => refreshUpcoming({ bust: true }));
            }
          }
        }
        function attachFightAvatars(root) {
          const scoped = root ? root.querySelectorAll.bind(root) : document.querySelectorAll.bind(document);
          scoped('#fightsContainer .rounded-2xl.w-full').forEach(mainCard => {
            if (mainCard.querySelector(".fighter-avatars-row")) return;
            const nameEls = mainCard.querySelectorAll(".fighter-name");
            const fCards = mainCard.querySelectorAll(".fight-card");
            nameEls.forEach((el, j) => {
              const host = fCards[j];
              if (!host) return;
              const header = host.querySelector("div > div:first-child");
              if (!header) return;
              if (header.querySelector(".fighter-avatar")) return;
              const wrap = document.createElement("div");
              wrap.className = "flex items-start justify-between gap-2 mb-2 fighter-avatars-row";
              wrap.innerHTML = `<div class="flex items-center gap-2 min-w-0">
                  <div class="fighter-avatar w-9 h-9 rounded-full flex items-center justify-center text-[11px] font-black text-white/95 shrink-0 border border-white/10 shadow-inner"></div>
                  <div class="min-w-0">
                    <div class="text-[10px] font-bold uppercase tracking-wider text-slate-500">Fighter ${j === 0 ? "A" : "B"}</div>
                    <div class="fighter-name-display text-[11px] font-bold text-slate-200 truncate max-w-[140px]">—</div>
                  </div>
                </div>
                <div class="fighter-badge-host shrink-0"></div>`;
              header.prepend(wrap);
              const avatar = wrap.querySelector(".fighter-avatar");
              const nameDisplay = wrap.querySelector(".fighter-name-display");
              const badgeHost = wrap.querySelector(".fighter-badge-host");
              function update() {
                const nm = (el.value || "").trim();
                avatar.style.background = nameGradient(nm || "TBD");
                avatar.textContent = initialsOf(nm || "?");
                nameDisplay.textContent = nm || "—";
                badgeHost.innerHTML = "";
              }
              update();
              el.addEventListener("input", update);
              el.addEventListener("blur", update);
            });
          });
        }
        // Share preview live updates
        const OG_MOCK_BADGE = document.getElementById("shareOgBadge");
        const OG_MOCK_CENTER = document.getElementById("shareOgCenter");
        const OG_MOCK_MODE = document.getElementById("shareOgMode");
        const OG_MOCK_BANK = document.getElementById("shareOgBank");
        const SHARE_LINK_BOX = document.getElementById("shareLinkBox");
        const SHARE_LINK_TEXT = document.getElementById("shareLinkText");
        const COPY_SHARE_BTN = document.getElementById("copyShareLinkBtn");
        const TWEET_BTN = document.getElementById("tweetShareBtn");
        const COPY_PARLAY_BTN = document.getElementById("copyParlayBtn");
        function updateSharePreview() {
          const fc = Number(document.getElementById("fightCount")?.value) || 0;
          const bank = Number(document.getElementById("bankroll")?.value) || 1000;
          const modeEl = document.querySelector('input[name="probMode"]:checked');
          const modeMap = { user: "My Confidence", fn: "Fightnomics Prior", market: "Market No-Vig" };
          const modeLabel = modeMap[modeEl?.value] || "My Confidence";
          if (OG_MOCK_BADGE) OG_MOCK_BADGE.textContent = `${fc || "?"} fights`;
          if (OG_MOCK_MODE) OG_MOCK_MODE.textContent = modeLabel;
          if (OG_MOCK_BANK) OG_MOCK_BANK.textContent = "Bankroll $" + bank.toLocaleString();
          if (OG_MOCK_CENTER) {
            const mainCards = document.querySelectorAll('#fightsContainer .rounded-2xl.w-full');
            const headliner = (() => {
              const mc0 = mainCards[0]; if (!mc0) return null;
              const ns = mc0.querySelectorAll(".fighter-name");
              const nA = (ns[0]?.value || "");
              const nB = (ns[1]?.value || "");
              if (!nA && !nB) return null;
              return (nA || "TBD") + " vs " + (nB || "TBD");
            })();
            OG_MOCK_CENTER.innerHTML = `<div class="text-[11px] text-slate-500 font-mono uppercase tracking-wider">Headliner ${fc > 1 ? `+ ${fc - 1}` : ""}</div>
              <div class="text-base font-black text-white leading-tight truncate">${headliner || "Build & save your card…"}</div>
              <div class="h-[2px] w-16 rounded-full bg-gradient-to-r from-red-600 to-transparent mt-2"></div>`;
          }
        }
        function enableShareButtons(permalink, payload) {
          if (SHARE_LINK_BOX) { SHARE_LINK_BOX.classList.remove("hidden"); }
          if (SHARE_LINK_TEXT && permalink) { SHARE_LINK_TEXT.textContent = permalink; SHARE_LINK_TEXT._url = permalink; }
          if (COPY_SHARE_BTN) { COPY_SHARE_BTN.disabled = false; COPY_SHARE_BTN.onclick = async () => {
            if (!SHARE_LINK_TEXT?._url) return;
            try { await navigator.clipboard.writeText(SHARE_LINK_TEXT._url); toast("✅ Link copied."); }
            catch(_) { toast("⚠️ Couldn't copy — highlight & copy manually."); }
          };}
          if (TWEET_BTN) {
            const fightsTxt = (payload?.fights || []).slice(0, 5).map(f => ((f.fighters||[]).map(x => x.name).filter(Boolean).join(" vs "))).filter(Boolean).join(" · ");
            const txt = encodeURIComponent(`My UFC MarX parlay pick:\n${fightsTxt}\nMode: ${payload?.probMode || "?"} · Bankroll $${payload?.bankroll || 0}\n`);
            const url = encodeURIComponent(permalink || location.href);
            TWEET_BTN.href = `https://twitter.com/intent/tweet?text=${txt}&url=${url}&hashtags=UFC,Parlay,KellyCriterion,Fightnomics`;
            TWEET_BTN.classList.remove("pointer-events-none","cursor-not-allowed","text-slate-500","bg-white/5","border-white/5");
            TWEET_BTN.classList.add("text-white","bg-sky-500/30","hover:bg-sky-500/40","border-sky-400/30");
          }
          if (COPY_PARLAY_BTN) { COPY_PARLAY_BTN.onclick = async () => {
            const fs = payload?.fights || [];
            const lines = fs.map((f, i) => {
              const g = f.fighters || [];
              const nA = (g[0]?.name || "Fighter A");
              const nB = (g[1]?.name || "Fighter B");
              const oA = Number(g[0]?.odds) || 0;
              const oB = Number(g[1]?.odds) || 0;
              return `F${i+1}: ${nA} @ ${oA.toFixed(2)}  vs  ${nB} @ ${oB.toFixed(2)}`;
            });
            const txt = `UFC MarX Risk Engine Card\nBankroll $${payload?.bankroll || 0} · Mode ${payload?.probMode || "?"}\n\n` + lines.join("\n") + (permalink ? `\n\nFull card: ${permalink}` : "");
            try { await navigator.clipboard.writeText(txt); toast("✅ Parlay text copied."); }
            catch(_) { toast("⚠️ Copy failed."); }
          };}
        }
        ["change","input","click","blur"].forEach(evt => document.addEventListener(evt, (e) => {
          if (!e.target) return;
          const id = e.target.id, name = e.target.name, cls = e.target.className;
          if (id === "fightCount" || id === "bankroll" || name === "probMode" || String(cls).includes("fighter-")) updateSharePreview();
        }, { passive: true }));
        // Expose save callback for backend integration to call after save
        window.__creative = { attachFightAvatars, updateSharePreview, enableShareButtons, refreshUpcoming };
        // Refresh upcoming once on load
        refreshUpcoming();
        if (REFRESH_BTN) REFRESH_BTN.addEventListener("click", () => refreshUpcoming({ bust: true }));
        if (COLLAPSE_BTN) {
          let collapsed = false;
          COLLAPSE_BTN.addEventListener("click", () => {
            collapsed = !collapsed;
            BODY.style.maxHeight = collapsed ? "0px" : "";
            const svg = COLLAPSE_BTN.querySelector("svg");
            if (svg) svg.style.transform = collapsed ? "rotate(180deg)" : "";
          });
        }
        // Header nav pills
        document.querySelectorAll(".nav-pill").forEach(btn => {
          btn.addEventListener("click", () => {
            document.querySelectorAll(".nav-pill").forEach(b => {
              b.classList.remove("bg-red-500/20","text-red-300","border","border-red-400/30");
              b.classList.add("text-slate-300","hover:bg-white/10");
            });
            btn.classList.add("bg-red-500/20","text-red-300","border","border-red-400/30");
            btn.classList.remove("text-slate-300","hover:bg-white/10");
            const n = btn.dataset.nav;
            if (n === "engine") document.getElementById("fightsContainer")?.scrollIntoView({ behavior: "smooth", block: "start" });
            else if (n === "upcoming") document.getElementById("upcomingPanel")?.scrollIntoView({ behavior: "smooth", block: "start" });
            else if (n === "saved") { if (typeof openSaved === "function") openSaved(); else document.getElementById("openSavedBtn")?.click(); }
          });
        });
        // Inject call hooks after buildFights: monkey-patch window.buildFights listener to add avatars
        setTimeout(() => {
          // Patch any build events
          attachFightAvatars();
          updateSharePreview();
          const fc = document.getElementById("fightCount");
          if (fc) {
            fc.addEventListener("change", () => {
              buildFights();
              setTimeout(attachFightAvatars, 350);
            });
          }
          const buildBtn = document.getElementById("buildBtn");
          if (buildBtn) buildBtn.addEventListener("click", () => setTimeout(attachFightAvatars, 350));
        }, 100);
      })();

      /* ---------- Backend Tier 1: Save Card + Saved Cards Dashboard ---------- */
      (function attachBackendIntegration() {
        const SAVE_BTN = document.getElementById("saveCardBtn");
        const OPEN_SAVED_BTN = document.getElementById("openSavedBtn");
        const CLOSE_SAVED_BTN = document.getElementById("closeSavedBtn");
        const SAVED_MODAL = document.getElementById("savedCardsModal");
        const TOAST = document.getElementById("saveCardToast");
        const DEFAULT_BASE = (typeof location !== "undefined" && location?.hostname === "localhost")
          ? `http://${location.hostname}:8787`
          : "http://localhost:8787";
        let BASE = (window.BACKEND_BASE_URL || DEFAULT_BASE).replace(/\/$/, "");
        function toast(html) {
          if (!TOAST) return;
          TOAST.querySelector(".save-card-body").innerHTML = html;
          TOAST.classList.remove("hidden");
          clearTimeout(toast._t);
          toast._t = setTimeout(() => TOAST.classList.add("hidden"), 7500);
        }
        window.toast = toast;
        function openSaved() {
          if (!SAVED_MODAL) return;
          SAVED_MODAL.classList.remove("hidden");
          SAVED_MODAL.classList.add("flex");
          playSoftClickSound?.();
          refreshSavedDashboard();
        }
        function closeSaved() {
          if (!SAVED_MODAL) return;
          SAVED_MODAL.classList.add("hidden");
          SAVED_MODAL.classList.remove("flex");
        }
        async function apiCall(method, path, body) {
          const url = BASE + path;
          const opts = { method, headers: { "Content-Type": "application/json" } };
          if (body) opts.body = JSON.stringify(body);
          try {
            const resp = await fetch(url, opts);
            const data = await resp.json().catch(() => null);
            if (!resp.ok || !data) throw new Error(data?.message || `HTTP ${resp.status}`);
            return data;
          } catch (err) {
            throw new Error(`Backend unreachable @ ${BASE}. Run:  cd backend && npm install && npm run dev   (${err.message})`);
          }
        }
        function serializeCurrentCard() {
          const count = document.getElementById("fightCount")?.value;
          const bankroll = document.getElementById("bankroll")?.value;
          const probEl = document.querySelector('input[name="probMode"]:checked');
          const mcEl = document.getElementById("mcToggle");
          const fightsOut = [];
          document.querySelectorAll('#fightsContainer .rounded-2xl.w-full').forEach((mainCard, i) => {
            const fighterEls = mainCard.querySelectorAll(".fighter-name");
            const oddsEls = mainCard.querySelectorAll(".fighter-odds");
            const confEls = mainCard.querySelectorAll(".fighter-confidence");
            const statEls = mainCard.querySelectorAll(".fighter-status");
            fightsOut.push({
              id: i + 1,
              fighters: [0, 1].map(j => ({
                name: fighterEls?.[j]?.value || "",
                odds: (typeof parseOddsToDecimal === "function" ? parseOddsToDecimal(oddsEls?.[j]?.value) : Number(oddsEls?.[j]?.value || 0)),
                confidence: Number(confEls?.[j]?.value || 50),
                status: statEls?.[j]?.value || "NEUTRAL"
              }))
            });
          });
          return {
            note: `UFC ${count || "?"} fights · BR ${bankroll || 1000} · ${new Date().toLocaleDateString()}`,
            bankroll: Number(bankroll) || 1000,
            probMode: probEl?.value || "user",
            mcEnabled: mcEl ? mcEl.checked : false,
            oddsFormatAmerican: (typeof oddsFormatAmerican !== "undefined") ? !!oddsFormatAmerican : false,
            source: (window.__SAVED_LIVE_SOURCE && typeof window.__SAVED_LIVE_SOURCE === "object") ? window.__SAVED_LIVE_SOURCE : undefined,
            fights: fightsOut,
            createdAt: new Date().toISOString()
          };
        }
        async function saveCard() {
          if (!SAVE_BTN) return;
          const payload = serializeCurrentCard();
          const fightCount = payload.fights.filter(f => f.fighters.some(x => x.name)).length;
          if (fightCount === 0) return toast("<span class='text-red-300'>Nothing to save — add fighters first.</span>");
          SAVE_BTN.disabled = true;
          const originalText = SAVE_BTN.textContent;
          SAVE_BTN.textContent = "Saving…";
          try {
            const data = await apiCall("POST", "/api/cards", payload);
            const share = data.card?.share_token || data.shareUrl;
            const shortLink = BASE + `/cards/${encodeURIComponent(share)}`;
            const linkText = share
              ? `<div class="mt-2"><a href="${shortLink}" target="_blank" class="underline text-emerald-200 font-mono text-xs break-all">🔗 Share: /cards/${share}</a></div>`
              : "";
            toast(`✅ Saved to backend (storage: ${data.storage || "?"}). ${linkText}`);
            // Creative share preview enable with permalink & share buttons
            try { if (window.__creative?.enableShareButtons) window.__creative.enableShareButtons(shortLink, payload); } catch(_) {}
          } catch (err) {
            toast(`<span class='text-red-300'>❌ Save failed. ${err.message}</span>`);
          } finally {
            SAVE_BTN.textContent = originalText;
            SAVE_BTN.disabled = false;
          }
        }

        /* ---------- Bets / ROI helpers ---------- */
        async function listBets(cardId) {
          const qs = cardId ? `?card_id=${encodeURIComponent(cardId)}` : "";
          const r = await apiCall("GET", "/api/bets" + qs);
          return (r.bets || []).map(b => ({
            id: b.id, cardId: b.card_id,
            outcome: b.outcome, settledAt: b.settled_at,
            createdAt: b.created_at,
            payload: (typeof b.payload === "string" ? JSON.parse(b.payload) : b.payload)
                     || (typeof b.payload_json === "string" ? JSON.parse(b.payload_json) : (b.payload_json || {}))
          }));
        }
        async function saveBet(bet) { return apiCall("POST", "/api/bets", bet); }
        async function settleBet(id, outcome) { return apiCall("PATCH", `/api/bets/${encodeURIComponent(id)}/settle`, { outcome }); }
        async function deleteBet(id) { return apiCall("DELETE", `/api/bets/${encodeURIComponent(id)}`); }

        function computeRoi(bets) {
          let totalStaked = 0, totalReturned = 0, wins = 0, losses = 0, pushes = 0, settled = 0;
          bets.forEach(b => {
            const p = b.payload || {};
            const stake = Number(p.stake) || 0;
            if (!stake) return;
            if (b.outcome === "WIN") {
              const oddsDec = Number(p.oddsDecimal) || 0;
              const profit = oddsDec > 0 ? (stake * (oddsDec - 1)) : 0;
              totalStaked += stake; totalReturned += stake + profit;
              wins++; settled++;
            } else if (b.outcome === "LOSS") {
              totalStaked += stake; totalReturned += 0;
              losses++; settled++;
            } else if (b.outcome === "PUSH") {
              totalStaked += stake; totalReturned += stake;
              pushes++; settled++;
            }
          });
          const netPL = totalReturned - totalStaked;
          const roiPct = totalStaked > 0 ? (netPL / totalStaked) * 100 : 0;
          const winPct = settled > 0 ? (wins / settled) * 100 : 0;
          return { totalStaked, totalReturned, netPL, roiPct, winPct, wins, losses, pushes, settled, pending: bets.length - settled };
        }
        function formatMoney(n) {
          const sign = n < 0 ? "-" : "";
          return sign + "$" + Math.abs(n).toFixed(0);
        }
        function roiStripHtml(bets, label) {
          const r = computeRoi(bets);
          const color = r.roiPct >= 0 ? "text-emerald-300" : "text-red-300";
          const lbl = label ? `<span class="uppercase tracking-wider text-[10px] text-slate-400 mr-2">${label} ·</span>` : "";
          return `<div class="rounded-lg border border-white/10 bg-white/5 p-3 text-xs space-y-1">
            ${lbl}<span class="text-slate-200 font-semibold">${r.settled}/${bets.length} settled</span>
            <span class="mx-2 text-slate-600">|</span>
            <span>Staked: <b>${formatMoney(r.totalStaked)}</b></span>
            <span class="mx-2 text-slate-600">|</span>
            <span>Net: <b class="${r.netPL >= 0 ? "text-emerald-300" : "text-red-300"}">${formatMoney(r.netPL)}</b></span>
            <span class="mx-2 text-slate-600">|</span>
            <span>W/L/P: <b class="text-slate-100">${r.wins}/${r.losses}/${r.pushes}</b> (Win% ${r.winPct.toFixed(0)}%)</span>
            <span class="mx-2 text-slate-600">|</span>
            <span>ROI: <b class="${color}">${r.roiPct.toFixed(1)}%</b></span>
            ${r.pending ? `<span class="mx-2 text-slate-600">|</span><span class="text-amber-300">Pending: ${r.pending}</span>` : ""}
          </div>`;
        }
        function mountModal(html, widthClass) {
          const wrap = document.createElement("div");
          wrap.className = "fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4";
          wrap.innerHTML = `<div class="${widthClass || "max-w-3xl"} w-full rounded-2xl border border-white/10 bg-[#0b0f16] text-slate-100 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">${html}</div>`;
          wrap.addEventListener("click", e => { if (e.target === wrap) document.body.removeChild(wrap); });
          document.body.appendChild(wrap);
          return wrap;
        }
        async function openAddBet(cardId, cardNote, cardPayload) {
          const fights = (cardPayload?.fights || []).slice(0, 5);
          if (!fights.length) { alert("This card has no fights yet — Load it first, add fighters, then Save again."); return; }
          const probMode = cardPayload?.probMode || "user";
          const bankroll = Number(cardPayload?.bankroll) || 1000;
          // Build fighter picklist with no-vig p for EV calc
          const picks = [];
          fights.forEach((f, i) => {
            const g = f.fighters || [];
            const oddA = Number(g[0]?.odds) || 0;
            const oddB = Number(g[1]?.odds) || 0;
            const noVigPair = (oddA >= 1.01 && oddB >= 1.01) ? [1/oddA, 1/oddB].map(x => x / (1/oddA + 1/oddB)) : [0.5, 0.5];
            const confA = Number(g[0]?.confidence) || 50;
            const confB = Number(g[1]?.confidence) || 50;
            const confSum = confA + confB;
            const confPair = confSum > 0 ? [confA / confSum, confB / confSum] : [0.5, 0.5];
            // fightnomics prior if we have the bundle loaded
            const tryFN = (() => { try { if (typeof fightnomicsPrior === "function" && g[0]?.name && g[1]?.name) { return fightnomicsPrior(g[0].name, g[1].name, oddA || 2.0, oddB || 2.0); } return null; } catch(_) { return null; } })();
            g.forEach((gg, j) => {
              if (!gg?.name) return;
              const odd = Number(gg.odds) || 0;
              const marketP = noVigPair[j] || 0;
              const userP = confPair[j] || 0;
              let p;
              if (probMode === "market") p = marketP;
              else if (probMode === "fn" && tryFN !== null) p = j === 0 ? tryFN : 1 - tryFN;
              else p = userP;
              p = Math.max(0.01, Math.min(0.99, p || 0.5));
              const kellyRaw = odd > 1.01 ? Math.max(0, ((odd - 1) * p - (1 - p)) / (odd - 1)) : 0;
              const kellyFrac = kellyRaw * 0.25; // 1/4 Kelly
              const stakeKelly = Math.max(1, Math.round(bankroll * kellyFrac));
              const evPct = odd > 1.01 ? (p * (odd - 1) - (1 - p)) * 100 : 0;
              const cls = (p >= 0.6 && odd >= 1.01) ? "FAVORITE" : (p <= 0.35 ? "LONGSHOT" : "UNDERDOG");
              picks.push({
                label: `${gg.name} (fight ${i+1}${j===0?" · A":" · B"})`, oddsDecimal: odd, fightIdx: i, side: j, name: gg.name,
                evPct, stakeKelly, p, cls, noVigP: marketP
              });
            });
          });
          const html = `
            <div class="p-5 border-b border-white/10 flex items-start justify-between gap-3">
              <div>
                <h3 class="text-xl font-extrabold flex items-center gap-2">💸 Record Bet <span class="text-[10px] font-bold uppercase tracking-widest rounded-full px-2 py-0.5 bg-white/5 border border-white/10 text-slate-300">${cardNote}</span></h3>
                <p class="text-[11px] text-slate-400 mt-0.5 font-mono">prob mode: ${probMode || "user"} · br: $${bankroll.toLocaleString()} · Kelly ¼× default stake</p>
              </div>
              <button class="close-modal text-slate-400 hover:text-white text-xl px-3 py-1">×</button>
            </div>
            <form class="p-5 space-y-4 overflow-y-auto">
              <div>
                <label class="block text-xs uppercase tracking-wider text-slate-400 mb-1.5">Pick</label>
                <select name="pickIndex" required class="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 text-sm focus:ring-2 focus:ring-red-500 focus:ring-offset-0 outline-none">
                  ${picks.map((p,i) => `<option value="${i}">${p.name} · F${p.fightIdx+1}${p.side===0?"A":"B"} · odds ${(p.oddsDecimal||0).toFixed(2) || "-"} · ${p.cls}</option>`).join("")}
                </select>
              </div>
              <div id="betSmartStrip" class="rounded-xl border border-white/10 bg-black/30 p-4 space-y-3">
                <div class="grid grid-cols-4 gap-3 text-center">
                  <div>
                    <div class="text-[9px] font-bold uppercase tracking-wider text-slate-500">Est. P</div>
                    <div id="betP" class="text-[15px] font-mono font-bold text-slate-200">—</div>
                  </div>
                  <div>
                    <div class="text-[9px] font-bold uppercase tracking-wider text-slate-500">No-vig P</div>
                    <div id="betNoVigP" class="text-[15px] font-mono font-bold text-blue-300">—</div>
                  </div>
                  <div>
                    <div class="text-[9px] font-bold uppercase tracking-wider text-slate-500">Edge (EV)</div>
                    <div id="betEV" class="text-[15px] font-mono font-bold text-emerald-300">—</div>
                  </div>
                  <div>
                    <div class="text-[9px] font-bold uppercase tracking-wider text-slate-500">Type</div>
                    <div id="betCls" class="text-[12px] font-black uppercase tracking-widest">—</div>
                  </div>
                </div>
                <div class="h-1.5 rounded-full bg-slate-800 overflow-hidden relative">
                  <div id="betProbBarA" class="absolute left-0 top-0 h-full bg-red-500/80 transition-all"></div>
                  <div id="betProbBarB" class="absolute right-0 top-0 h-full bg-blue-500/80 transition-all"></div>
                  <div id="betProbLine" class="absolute top-0 bottom-0 w-0.5 bg-white z-10 shadow-lg"></div>
                </div>
                <div class="flex items-center justify-between text-[10px] font-mono text-slate-400">
                  <span>← Fighter A</span>
                  <span id="betVsNames">— vs —</span>
                  <span>Fighter B →</span>
                </div>
              </div>
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="block text-xs uppercase tracking-wider text-slate-400 mb-1">Stake $ <button type="button" id="useKellyBtn" class="ml-1 px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-widest bg-red-500/20 border border-red-400/30 text-red-300 hover:bg-red-500/30 transition-colors">KELLY</button></label>
                  <input type="number" min="1" step="1" value="50" name="stake" required class="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 text-sm focus:ring-2 focus:ring-red-500 outline-none font-mono">
                  <p id="betPotential" class="mt-1 text-[10px] font-mono text-slate-400">Potential return: —</p>
                </div>
                <div>
                  <label class="block text-xs uppercase tracking-wider text-slate-400 mb-1">Odds (decimal)</label>
                  <input type="number" step="0.01" min="1.01" name="oddsDecimal" required class="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 text-sm focus:ring-2 focus:ring-red-500 outline-none font-mono">
                  <p id="betAmerican" class="mt-1 text-[10px] font-mono text-slate-400">American: —</p>
                </div>
              </div>
              <div>
                <label class="block text-xs uppercase tracking-wider text-slate-400 mb-1">Note (optional)</label>
                <input type="text" name="note" placeholder="e.g. Kelly-single · Fightnomics drive" class="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 text-sm focus:ring-2 focus:ring-red-500 outline-none">
              </div>
              <div class="flex items-center justify-end gap-2 pt-2 border-t border-white/5">
                <button type="button" class="close-modal rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10 transition-colors">Cancel</button>
                <button type="submit" class="rounded-md bg-gradient-to-br from-emerald-500 to-emerald-700 hover:from-emerald-400 hover:to-emerald-600 px-5 py-2 text-sm font-bold shadow-lg shadow-emerald-900/30 transition-all">💾 Save Bet</button>
              </div>
            </form>`;
          const wrap = mountModal(html, "max-w-2xl");
          wrap.querySelectorAll(".close-modal").forEach(b => b.addEventListener("click", () => document.body.removeChild(wrap)));
          const form = wrap.querySelector("form");
          const oddsEl = form.querySelector('input[name="oddsDecimal"]');
          const stakeEl = form.querySelector('input[name="stake"]');
          const betP = wrap.querySelector("#betP");
          const betNoVigP = wrap.querySelector("#betNoVigP");
          const betEV = wrap.querySelector("#betEV");
          const betCls = wrap.querySelector("#betCls");
          const betVsNames = wrap.querySelector("#betVsNames");
          const betProbBarA = wrap.querySelector("#betProbBarA");
          const betProbBarB = wrap.querySelector("#betProbBarB");
          const betProbLine = wrap.querySelector("#betProbLine");
          const betPotential = wrap.querySelector("#betPotential");
          const betAmerican = wrap.querySelector("#betAmerican");
          const kellyBtn = wrap.querySelector("#useKellyBtn");
          function toAmerican(d) {
            d = Number(d) || 0;
            if (d >= 2.0) return "+" + Math.round((d - 1) * 100);
            if (d > 1.0 && d < 2.0) return "-" + Math.round(100 / (d - 1));
            return "—";
          }
          const selectEl = form.querySelector('select[name="pickIndex"]');
          function updateSmartStrip() {
            const p = picks[Number(selectEl.value)];
            if (!p) return;
            const fight = fights[p.fightIdx] || {};
            const fA = (fight.fighters || [])[0];
            const fB = (fight.fighters || [])[1];
            const myP = p.side === 0 ? Number(p.p) : (1 - Number(p.p));
            const theirP = 1 - myP;
            const noVig = p.side === 0 ? Number(p.noVigP) : (1 - Number(p.noVigP));
            betP.textContent = Math.round(100 * myP) + "%";
            betNoVigP.textContent = Math.round(100 * noVig) + "%";
            const delta = (myP - noVig) * 100;
            const evNum = Number(p.evPct) || 0;
            betEV.textContent = (evNum >= 0 ? "+" : "") + evNum.toFixed(1) + "%";
            betEV.className = "text-[15px] font-mono font-bold " + (evNum >= 1 ? "text-emerald-300" : evNum <= -2 ? "text-rose-300" : "text-slate-300");
            betCls.textContent = p.cls;
            betCls.className = "text-[12px] font-black uppercase tracking-widest " + (p.cls === "FAVORITE" ? "text-emerald-300" : p.cls === "LONGSHOT" ? "text-fuchsia-300" : "text-amber-300");
            const aLabel = fA?.name || "A";
            const bLabel = fB?.name || "B";
            betVsNames.textContent = aLabel + " vs " + bLabel;
            // Probability bar: A on left, B on right; line at boundary (myP)
            betProbBarA.style.width = (myP * 100).toFixed(1) + "%";
            betProbBarB.style.width = (theirP * 100).toFixed(1) + "%";
            // Center divider at 50% for symmetry visualization of the two sides
            betProbLine.style.left = "50%";
          }
          function updateStakeMaths() {
            const st = Number(stakeEl.value) || 0;
            const od = Number(oddsEl.value) || 0;
            const toWin = od > 1 ? (st * (od - 1)) : 0;
            betPotential.textContent = "Potential net win: $" + toWin.toFixed(2) + "  ·  Total return: $" + (st + toWin).toFixed(2);
            betAmerican.textContent = "American: " + toAmerican(od);
          }
          function applyKelly() {
            const p = picks[Number(selectEl.value)];
            if (p) { stakeEl.value = String(p.stakeKelly || 1); stakeEl.dispatchEvent(new Event("input", { bubbles: true })); }
          }
          kellyBtn.addEventListener("click", applyKelly);
          selectEl.addEventListener("change", () => {
            const p = picks[Number(selectEl.value)];
            if (p && p.oddsDecimal) oddsEl.value = p.oddsDecimal.toFixed(2);
            applyKelly();
            updateSmartStrip();
            updateStakeMaths();
          });
          oddsEl.addEventListener("input", updateStakeMaths);
          oddsEl.addEventListener("change", updateStakeMaths);
          stakeEl.addEventListener("input", updateStakeMaths);
          // Initial fill
          if (picks[0]?.oddsDecimal) oddsEl.value = picks[0].oddsDecimal.toFixed(2);
          applyKelly();
          updateSmartStrip();
          updateStakeMaths();
          form.addEventListener("submit", async (ev) => {
            ev.preventDefault();
            const fd = new FormData(form);
            const pick = picks[Number(fd.get("pickIndex"))];
            const bet = {
              card_id: cardId,
              stake: Number(fd.get("stake")),
              oddsDecimal: Number(fd.get("oddsDecimal")),
              note: String(fd.get("note") || ""),
              pick: { fightIdx: pick.fightIdx, side: pick.side, name: pick.name, label: pick.label, cls: pick.cls, evPct: pick.evPct },
              outcome: null,
              createdAt: new Date().toISOString()
            };
            try {
              await saveBet(bet);
              toast("✅ Bet saved · " + pick.cls + " EV " + (pick.evPct >= 0 ? "+" : "") + pick.evPct.toFixed(1) + "%");
              document.body.removeChild(wrap);
              refreshSavedDashboard();
            } catch (err) {
              toast(`<span class='text-red-300'>❌ Bet save failed. ${err.message}</span>`);
            }
          });
        }
        async function openBetsList(cardId, cardNote, cardPayload) {
          const fights = cardPayload?.fights || [];
          let bets = [];
          try { bets = await listBets(cardId); } catch (err) { toast(`<span class='text-red-300'>❌ ${err.message}</span>`); return; }
          const rowsHtml = !bets.length ? `<p class="text-slate-500 italic text-sm p-6 text-center">No bets recorded for this card yet — 💸 Add a bet first.</p>` :
            bets.map(b => {
              const p = b.payload || {};
              const colorCls = !b.outcome ? "text-amber-300" : b.outcome === "WIN" ? "text-emerald-300" : b.outcome === "LOSS" ? "text-red-300" : "text-slate-400";
              const stake = Number(p.stake) || 0;
              const odds = Number(p.oddsDecimal) || 0;
              const potential = b.outcome === "WIN" ? (odds > 0 ? stake * odds : 0) : (odds > 0 ? stake * odds : 0);
              return `<tr class="border-t border-white/5">
                <td class="px-3 py-2 text-xs text-slate-200 align-top">${new Date(b.createdAt || Date.now()).toLocaleString()}</td>
                <td class="px-3 py-2 text-xs align-top font-semibold">${p.pick?.name || "—"}</td>
                <td class="px-3 py-2 text-xs align-top text-slate-300 font-mono">${odds.toFixed(2) || "-"}</td>
                <td class="px-3 py-2 text-xs align-top text-right font-mono">$${stake.toFixed(0)}</td>
                <td class="px-3 py-2 text-xs align-top text-right font-mono ${b.outcome === "LOSS" ? "text-red-300" : ""}">$${potential.toFixed(0)}</td>
                <td class="px-3 py-2 text-xs align-top"><span class="${colorCls} font-bold">${b.outcome || "PENDING"}</span></td>
                <td class="px-3 py-2 text-xs align-top text-slate-400 font-mono">${p.note || ""}</td>
                <td class="px-3 py-2 text-xs align-top">
                  <div class="flex gap-1 flex-wrap">
                    ${!b.outcome ? `
                      <button class="b-settle inline-block rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300 hover:bg-emerald-500/20" data-id="${b.id}" data-v="WIN">WIN</button>
                      <button class="b-settle inline-block rounded border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[10px] text-red-300 hover:bg-red-500/20" data-id="${b.id}" data-v="LOSS">LOSS</button>
                      <button class="b-settle inline-block rounded border border-slate-500/30 bg-slate-500/10 px-2 py-0.5 text-[10px] text-slate-300 hover:bg-slate-500/20" data-id="${b.id}" data-v="PUSH">PUSH</button>` :
                      `<button class="b-unsettle inline-block rounded border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-slate-300 hover:bg-white/10" data-id="${b.id}">Reset</button>`}
                    <button class="b-del inline-block rounded border border-red-500/20 bg-red-500/5 px-2 py-0.5 text-[10px] text-red-300 hover:bg-red-500/15" data-id="${b.id}">🗑️</button>
                  </div>
                </td>
              </tr>`;
            }).join("");
          const html = `
            <div class="p-5 border-b border-white/10 flex items-center justify-between">
              <h3 class="text-xl font-extrabold">📊 Bets — <span class="text-slate-300 font-semibold">${cardNote}</span></h3>
              <button class="close-modal text-slate-400 hover:text-white text-xl px-3 py-1">×</button>
            </div>
            <div class="p-4 border-b border-white/5">${roiStripHtml(bets, "Card ROI")}</div>
            <div class="overflow-y-auto">
              <table class="w-full text-left">
                <thead class="sticky top-0 bg-[#0b0f16] border-b border-white/10 text-[10px] uppercase tracking-wider text-slate-400">
                  <tr>
                    <th class="px-3 py-2">Date</th><th class="px-3 py-2">Pick</th><th class="px-3 py-2">Odds</th>
                    <th class="px-3 py-2 text-right">Stake</th><th class="px-3 py-2 text-right">Return</th>
                    <th class="px-3 py-2">Result</th><th class="px-3 py-2">Note</th><th class="px-3 py-2 w-48">Actions</th>
                  </tr>
                </thead>
                <tbody>${rowsHtml}</tbody>
              </table>
            </div>
            <div class="p-4 border-t border-white/5 flex justify-end gap-2">
              <button class="b-add-here rounded-md bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 text-sm font-semibold">💸 Add Bet</button>
              <button class="close-modal rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-sm hover:bg-white/10">Close</button>
            </div>`;
          const wrap = mountModal(html, "max-w-5xl");
          wrap.querySelectorAll(".close-modal").forEach(b => b.addEventListener("click", () => document.body.removeChild(wrap)));
          wrap.querySelector(".b-add-here").addEventListener("click", async () => {
            document.body.removeChild(wrap);
            openAddBet(cardId, cardNote, cardPayload);
          });
          wrap.querySelectorAll(".b-settle").forEach(b => b.addEventListener("click", async () => {
            try { await settleBet(b.dataset.id, b.dataset.v); toast(`✅ Marked ${b.dataset.v}.`); document.body.removeChild(wrap); openBetsList(cardId, cardNote, cardPayload); }
            catch (e) { toast(`<span class='text-red-300'>❌ ${e.message}</span>`); }
          }));
          wrap.querySelectorAll(".b-unsettle").forEach(b => b.addEventListener("click", async () => {
            try {
              // Unsettle via PATCH set null outcome via REST via custom endpoint
              await fetch(BASE + `/api/bets/${encodeURIComponent(b.dataset.id)}/settle`, {
                method: "PATCH", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ outcome: "" })
              }).then(async (r) => {
                if (!r.ok) throw new Error("HTTP " + r.status);
              });
              toast("✅ Bet reset to PENDING."); document.body.removeChild(wrap); openBetsList(cardId, cardNote, cardPayload);
            } catch (e) { toast(`<span class='text-red-300'>❌ ${e.message}</span>`); }
          }));
          wrap.querySelectorAll(".b-del").forEach(b => b.addEventListener("click", async () => {
            if (!confirm("Delete this bet record?")) return;
            try { await deleteBet(b.dataset.id); toast("✅ Bet deleted."); document.body.removeChild(wrap); openBetsList(cardId, cardNote, cardPayload); }
            catch (e) { toast(`<span class='text-red-300'>❌ ${e.message}</span>`); }
          }));
        }

        let SAVED_SORT = "recent";
        let SAVED_SEARCH = "";
        let __savedRenderedAll = null;
        let __savedRerenderScheduled = null;
        function rerenderSavedFromCache() {
          if (!__savedRenderedAll) return;
          const list = SAVED_MODAL?.querySelector(".saved-list");
          if (!list) return;
          const { enriched, svgWinRing, bestRoi, BASE } = __savedRenderedAll;
          let visible = enriched.slice();
          const q = String(SAVED_SEARCH || "").trim().toLowerCase();
          if (q) {
            visible = visible.filter(r => {
              const parts = [r.raw.note || "", r.raw.share_token || ""];
              (r.payload?.fights || []).forEach(ff => (ff.fighters || []).forEach(g => parts.push(g.name || "")));
              const hay = parts.join(" ").toLowerCase();
              return hay.includes(q);
            });
          }
          const cmpMap = {
            recent: (a,b) => b.created - a.created,
            roi:    (a,b) => b.roi - a.roi,
            winpct: (a,b) => (isNaN(b.wp)?-1:b.wp) - (isNaN(a.wp)?-1:a.wp),
            bets:   (a,b) => b.stat.count - a.stat.count,
          };
          visible.sort(cmpMap[SAVED_SORT] || cmpMap.recent);
          // Same template render below (reuse enriched + helpers)
          const templateFor = (r) => {
            const c = r.raw; const f = r.payload; const s = r.stat;
            const fs = f.fights || [];
            const shareToken = c.share_token || "";
            const fString = JSON.stringify(f).replace(/"/g, "&quot;");
            const nString = (c.note || "Saved card").replace(/"/g, "&quot;");
            const isTop = (r.roi === bestRoi) && isFinite(bestRoi) && s.count > 0;
            const roiClass = r.roi > 0 ? "text-emerald-300" : (r.roi < 0 ? "text-rose-300" : "text-slate-400");
            const summary = fs.slice(0, 3).map(ff => (ff.fighters || []).map(x => x.name).filter(Boolean).join(" vs ")).filter(Boolean).join(" · ") + (fs.length > 3 ? ` · +${fs.length - 3} more` : "");
            const modeColor = f.probMode === "fn" ? "text-cyan-300" : (f.probMode === "market" ? "text-blue-300" : "text-amber-300");
            const srcChip = (() => {
              const src = f.source;
              if (!src || typeof src !== "object") return "";
              if (String(src.type || "").toLowerCase() === "live-odds") {
                const dt = src.at ? new Date(src.at) : null;
                const hhmm = dt ? String(dt.getUTCHours()).padStart(2,"0") + ":" + String(dt.getUTCMinutes()).padStart(2,"0") : "";
                const prov = String(src.provider || "odds-api").replace(/[^a-z0-9-]/gi, "").slice(0, 16) || "odds-api";
                return `<span class="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider rounded-full px-2 py-0.5 border border-emerald-400/30 bg-gradient-to-r from-emerald-500/20 to-cyan-500/20 text-emerald-200" title="Populated via ⚡ LIVE · ${prov}${src.eventLabel ? " — " + src.eventLabel : ""}">📡 LIVE${hhmm ? ` · ${hhmm} UTC` : ""}</span>`;
              }
              return "";
            })();
            const statusColor = (s2) => s2 === "WIN" ? "bg-emerald-500/15 text-emerald-300 border-emerald-400/30" : s2 === "LOSS" ? "bg-rose-500/15 text-rose-300 border-rose-400/30" : s2 === "PUSH" ? "bg-sky-500/15 text-sky-300 border-sky-400/30" : "bg-white/5 text-slate-400 border-white/10";
            const expandRows = (fs || []).map((ff, idx) => {
              const gs = ff.fighters || [];
              const gA = gs[0] || {}; const gB = gs[1] || {};
              const stA = String(gA.status || "NEUTRAL").toUpperCase();
              const stB = String(gB.status || "NEUTRAL").toUpperCase();
              const nA = (gA.name || "TBD");
              const nB = (gB.name || "TBD");
              const oA = Number(gA.odds) || 0; const oB = Number(gB.odds) || 0;
              const cA = Number(gA.confidence) || 0; const cB = Number(gB.confidence) || 0;
              return `<div class="grid grid-cols-12 gap-2 items-center py-2 px-3 rounded-lg bg-black/20 border border-white/5 text-[11px]">
                <div class="col-span-1 text-slate-500 font-bold font-mono text-center">F${idx+1}</div>
                <div class="col-span-4 min-w-0">
                  <div class="truncate text-slate-200 font-semibold">${nA}</div>
                  <div class="text-[10px] text-slate-500 font-mono">${oA>1?oA.toFixed(2):"—"} · ${cA?cA+"% conf":""}</div>
                </div>
                <div class="col-span-1 text-center"><span class="inline-flex rounded-md px-1.5 py-0.5 border text-[9px] font-bold uppercase tracking-wider ${statusColor(stA)}">${stA}</span></div>
                <div class="col-span-1 text-center text-slate-500">vs</div>
                <div class="col-span-1 text-center"><span class="inline-flex rounded-md px-1.5 py-0.5 border text-[9px] font-bold uppercase tracking-wider ${statusColor(stB)}">${stB}</span></div>
                <div class="col-span-4 min-w-0 text-right">
                  <div class="truncate text-slate-200 font-semibold">${nB}</div>
                  <div class="text-[10px] text-slate-500 font-mono">${oB>1?oB.toFixed(2):"—"} · ${cB?cB+"% conf":""}</div>
                </div>
              </div>`;
            }).join("");
            return `<div class="group relative rounded-xl border ${isTop ? "border-amber-400/40 bg-gradient-to-br from-amber-500/5 to-transparent" : "border-white/10 bg-white/5"} p-4 space-y-3 hover:border-white/20 transition-all" data-card-id="${c.id}">
              ${isTop ? `<div class="absolute -top-2.5 right-3 rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-widest bg-amber-400/90 text-slate-950 border border-amber-300 shadow-lg shadow-amber-900/20">⭐ TOP ROI</div>` : ""}
              <div class="flex items-start justify-between gap-3">
                <div class="flex items-start gap-3 min-w-0">
                  <button class="saved-expand-btn shrink-0 rounded-md p-2 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 hover:text-slate-200 transition-all" title="Click to expand fight list" aria-label="Expand">
                    <svg class="w-3.5 h-3.5 saved-expand-chevron transition-transform duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
                  </button>
                  ${svgWinRing(r.wp, 34)}
                  <div class="min-w-0">
                    <div class="flex items-center gap-2 flex-wrap">
                      <div class="font-bold text-slate-100 leading-tight">${c.note || "Saved card"}</div>
                      <span class="text-[9px] font-bold uppercase tracking-[0.15em] rounded-full px-1.5 py-0.5 border border-white/5 bg-white/5 ${modeColor}">${f.probMode || "user"}</span>
                      ${srcChip}
                    </div>
                    <div class="text-[11px] text-slate-400 mt-0.5 font-mono leading-tight">Saved ${new Date(c.created_at || Date.now()).toLocaleString()}${c.updated_at && c.updated_at !== c.created_at ? ` · updated ${new Date(c.updated_at).toLocaleString()}` : ""}</div>
                  </div>
                </div>
                <div class="text-right shrink-0">
                  <div class="text-[9px] font-bold uppercase tracking-wider text-slate-500">Card ROI</div>
                  <div class="text-[18px] font-mono font-black ${roiClass}">${isFinite(r.roi)?(r.roi>=0?"+":"")+r.roi.toFixed(1)+"%":"—"}</div>
                </div>
              </div>
              <div class="grid grid-cols-4 gap-3 rounded-lg bg-black/30 border border-white/5 p-3 text-center">
                <div><div class="text-[9px] font-bold uppercase tracking-wider text-slate-500">Bets</div><div class="text-[13px] font-mono font-bold text-slate-200">${s.count}</div></div>
                <div><div class="text-[9px] font-bold uppercase tracking-wider text-slate-500">W-L-P</div><div class="text-[13px] font-mono font-bold text-slate-200">${s.w}-${s.l}-${s.p}</div></div>
                <div><div class="text-[9px] font-bold uppercase tracking-wider text-slate-500">Staked</div><div class="text-[13px] font-mono font-bold text-slate-200">$${s.staked.toFixed(0)}</div></div>
                <div><div class="text-[9px] font-bold uppercase tracking-wider text-slate-500">Net</div><div class="text-[13px] font-mono font-bold ${s.net>=0?"text-emerald-300":(s.net<0?"text-rose-300":"text-slate-200")}">${s.net>=0?"+":""}$${s.net.toFixed(0)}</div></div>
              </div>
              <div class="text-xs text-slate-300 leading-tight line-clamp-2">${summary || "(no fighters entered yet)"}</div>
              <div class="saved-fights-detail hidden space-y-1.5 border-t border-white/5 pt-3">${expandRows || '<p class="text-xs text-slate-500 italic">No fights stored on this saved card.</p>'}</div>
              <div class="flex items-center justify-between gap-3 flex-wrap">
                <div class="text-[11px] text-slate-500 font-mono shrink-0">${fs.length} fights · br: $${Number(f.bankroll||0).toLocaleString()}</div>
                <div class="flex items-center gap-2 flex-wrap">
                  <button class="saved-rename inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-300 hover:bg-white/10 font-semibold" data-id="${c.id}" title="Rename this saved card">✏️ Rename</button>
                  <button class="saved-delete inline-flex items-center gap-1 rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-300 hover:bg-rose-500/20 font-semibold" data-id="${c.id}" title="Permanently delete this saved card + bets">🗑️ Delete</button>
                  <button class="saved-addbet inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-300 hover:bg-emerald-500/20 font-semibold" data-id="${c.id}" data-note="${nString}" data-f='${fString}'>💸 Add Bet</button>
                  <button class="saved-bets inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-300 hover:bg-amber-500/20 font-semibold" data-id="${c.id}" data-note="${nString}" data-f='${fString}'>📊 Bets</button>
                  <a class="saved-load inline-flex items-center gap-1 rounded-md border border-cyan-500/40 bg-cyan-500/10 px-3 py-1 text-[11px] text-cyan-300 hover:bg-cyan-500/20 font-semibold cursor-pointer" data-id="${c.id}" data-share="${shareToken}">Load →</a>
                  <a class="saved-share inline-flex items-center gap-1 rounded-md border border-violet-500/40 bg-violet-500/10 px-2 py-1 text-[11px] text-violet-300 hover:bg-violet-500/20 font-semibold cursor-pointer" target="_blank" href="${BASE}/cards/${encodeURIComponent(shareToken)}">Share 🔗</a>
                </div>
              </div>
            </div>`;
          };
          const hitCountText = q ? `<p class="text-[11px] text-slate-500 font-mono">Search "${q}": ${visible.length}/${enriched.length} saved cards</p>` : "";
          list.innerHTML = hitCountText + (visible.length ? visible.map(templateFor).join("") : `<p class="text-slate-500 italic text-sm">No saved cards match "${q}".</p>`);
          // Re-attach handlers on re-rendered list
          list.querySelectorAll(".saved-load").forEach(btn => btn.addEventListener("click", () => loadCardByToken(btn.dataset.share)));
          list.querySelectorAll(".saved-rename").forEach(btn => btn.addEventListener("click", async () => {
            const id = btn.dataset.id; if (!id) return;
            const curr = btn.closest(".group")?.querySelector(".font-bold.text-slate-100")?.textContent?.trim() || "Saved card";
            const val = window.prompt("Rename saved card:", curr);
            if (val == null || val === curr) return;
            try {
              await apiCall("PATCH", "/api/cards/" + encodeURIComponent(id), { note: val });
              toast(`✅ Card renamed to "${val.slice(0,48)}${val.length>48?"…":""}".`);
              refreshSavedDashboard();
            } catch (e) { toast(`<span class="text-red-300">❌ Rename failed: ${e.message}</span>`); }
          }, { once: true }));
          list.querySelectorAll(".saved-delete").forEach(btn => btn.addEventListener("click", async () => {
            const id = btn.dataset.id; if (!id) return;
            const title = btn.closest(".group")?.querySelector(".font-bold.text-slate-100")?.textContent?.trim() || "this card";
            const ok = window.confirm(`Delete "${title}"?\n\n⚠️ All bets attached to this saved card will also be deleted. This CANNOT be undone.`);
            if (!ok) return;
            try {
              await apiCall("DELETE", "/api/cards/" + encodeURIComponent(id));
              toast(`🗑️ Saved card "${title.slice(0,48)}${title.length>48?"…":""}" permanently deleted.`);
              refreshSavedDashboard();
            } catch (e) { toast(`<span class="text-red-300">❌ Delete failed: ${e.message}</span>`); }
          }, { once: true }));
          list.querySelectorAll(".saved-addbet").forEach(btn => btn.addEventListener("click", () => {
            const payload = (() => { try { return JSON.parse(btn.dataset.f); } catch(_) { return null; } })();
            openAddBet(btn.dataset.id, btn.dataset.note, payload);
          }));
          list.querySelectorAll(".saved-bets").forEach(btn => btn.addEventListener("click", () => {
            const payload = (() => { try { return JSON.parse(btn.dataset.f); } catch(_) { return null; } })();
            openBetsList(btn.dataset.id, btn.dataset.note, payload);
          }));
          list.querySelectorAll(".saved-expand-btn").forEach(btn => btn.addEventListener("click", (ev) => {
            ev.stopPropagation();
            const card = btn.closest(".group"); if (!card) return;
            const detail = card.querySelector(".saved-fights-detail");
            const chev = btn.querySelector(".saved-expand-chevron");
            if (!detail) return;
            const isOpen = !detail.classList.contains("hidden");
            detail.classList.toggle("hidden", isOpen);
            if (chev) chev.style.transform = isOpen ? "rotate(0deg)" : "rotate(180deg)";
          }));
          list.querySelectorAll(".group[data-card-id]").forEach(card => card.addEventListener("click", (ev) => {
            if (ev.target.closest("button, a, input, textarea, select")) return;
            const btn = card.querySelector(".saved-expand-btn");
            if (btn) btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
          }));
        }
        async function refreshSavedDashboard() {
          if (!SAVED_MODAL) return;
          const strip = SAVED_MODAL.querySelector(".saved-status-strip");
          const list = SAVED_MODAL.querySelector(".saved-list");
          const countBadge = SAVED_MODAL.querySelector("#savedCountBadge");
          const spark = SAVED_MODAL.querySelector("#savedSparkline");
          const roiMetrics = SAVED_MODAL.querySelector("#savedRoiMetrics");
          const sortHost = SAVED_MODAL.querySelector(".saved-sort");
          const searchEl = SAVED_MODAL.querySelector("#savedSearch");
          try {
            if (searchEl) {
              searchEl.value = SAVED_SEARCH || "";
              if (!searchEl.__savedSearchWired) {
                searchEl.__savedSearchWired = true;
                searchEl.addEventListener("input", (e) => {
                  SAVED_SEARCH = e.target.value || "";
                  if (__savedRerenderScheduled) clearTimeout(__savedRerenderScheduled);
                  __savedRerenderScheduled = setTimeout(() => rerenderSavedFromCache(), 180);
                });
              }
            }
            const me = await apiCall("GET", "/api/auth/me").catch(() => null);
            const listData = await apiCall("GET", "/api/cards");
            const allBetsPromise = listBets().catch(() => []);
            if (strip) {
              const storage = (listData.storage || me?.storage || "unknown") + (me?.authenticated ? " · authenticated" : " · ANON demo");
              const odds = me?.features?.oddsFeed ? `✅ Live odds: ${me.features.realOddsProvider}` : "ℹ️ Odds: STUB demo (set ODDS_API_KEY)";
              strip.innerHTML = `<div><span class="font-bold uppercase tracking-wider text-[10px] text-slate-400 mr-1">Storage:</span> <span class="text-emerald-300 font-semibold">${storage}</span></div><div class="mt-1 opacity-80">${odds} · Count saved: ${listData.count || 0}</div>`;
              if (!me?.authenticated) {
                strip.innerHTML += `<div class="mt-2 text-orange-300 text-[11px] leading-tight">ℹ️ No auth configured: set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + SUPABASE_JWT_SECRET in backend/.env → Supabase Auth (email / Google / Apple).</div>`;
              }
            }
            const cards = listData.cards || [];
            if (countBadge) countBadge.textContent = String(cards.length);
            const heading = SAVED_MODAL?.querySelector(".saved-cards-dashboard-heading, [data-saved-heading], h3");
            if (heading) { heading.textContent = `🗂️ Saved Cards Dashboard ${cards.length}`; }
            const allBets = await allBetsPromise;
            // ---- Per-card stats
            const cardStats = new Map();
            let totalStaked = 0, totalNet = 0, wins = 0, losses = 0, pushes = 0, pend = 0;
            
            // For portfolio chart
            const settledBetsForChart = allBets
              .filter(b => ["WIN","LOSS","PUSH"].includes(String(b.outcome||"").toUpperCase()))
              .sort((a,b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));

            allBets.forEach(b => {
              const cId = b.cardId;
              const p = b.payload || {};
              const st = Number(p.stake) || 0;
              if (!st) return;
              const stat = cardStats.get(cId) || { staked: 0, net: 0, w: 0, l: 0, p: 0, pd: 0, count: 0 };
              stat.count++; stat.staked += st;
              const s = String(b.outcome || "").toUpperCase();
              if (s === "WIN") {
                const oddsDec = Number(p.oddsDecimal) || 0;
                const profit = oddsDec > 1 ? (st * (oddsDec - 1)) : 0;
                totalNet += profit; stat.net += profit; stat.w++; wins++;
              } else if (s === "LOSS") {
                totalNet -= st; stat.net -= st; stat.l++; losses++;
              } else if (s === "PUSH") {
                stat.p++; pushes++;
              } else {
                stat.pd++; pend++;
              }
              totalStaked += st;
              cardStats.set(cId, stat);
            });
            const roiPct = totalStaked > 0 ? (totalNet / totalStaked) * 100 : 0;
            const winPct = (wins + losses + pushes) > 0 ? (wins / (wins + losses + pushes)) * 100 : 0;
            if (roiMetrics) roiMetrics.innerHTML = [
              { k: "Staked", v: money(totalStaked), c: "text-slate-300" },
              { k: "Net P/L", v: (totalNet >= 0 ? "+" : "") + money(totalNet), c: totalNet >= 0 ? "text-anthropic-green" : "text-anthropic-orange" },
              { k: "W-L-P", v: `${wins}-${losses}-${pushes}`, c: "text-slate-300" },
              { k: "Win%", v: winPct.toFixed(0) + "%", c: "text-anthropic-blue" },
              { k: "ROI", v: (roiPct >= 0 ? "+" : "") + roiPct.toFixed(1) + "%", c: roiPct >= 0 ? "text-anthropic-green font-black" : "text-anthropic-orange font-black" }
            ].map(m => `<div class="bg-white/5 px-3 py-2 rounded-lg border border-white/5 min-w-[80px] text-center"><div class="text-[8px] font-black uppercase tracking-widest text-anthropic-mid mb-1">${m.k}</div><div class="text-sm font-ufc ${m.c}">${m.v}</div></div>`).join("");
            
            // Upgrade to Chart.js Portfolio Chart
            const portfolioCanvas = SAVED_MODAL.querySelector("#portfolioChart");
            if (portfolioCanvas) {
              drawPortfolioChart(portfolioCanvas, settledBetsForChart);
            }
            if (!cards.length) {
              list.innerHTML = `<p class="text-slate-500 italic text-sm">No saved cards yet — build a fight card, then 💾 Save Card.</p>`;
              return;
            }
            // Per-card render + sort
            const enriched = cards.map(c => {
              const rawPayload = c.payload_json ?? c.payload ?? {};
              const f = typeof rawPayload === "string" ? (() => { try { return JSON.parse(rawPayload); } catch(_) { return {}; } })() : rawPayload;
              const s = cardStats.get(c.id) || { staked:0, net:0, w:0, l:0, p:0, pd:0, count:0 };
              const roi = s.staked > 0 ? (s.net / s.staked) * 100 : 0;
              const wp = (s.w + s.l + s.p) > 0 ? (s.w / (s.w + s.l + s.p)) * 100 : NaN;
              return { raw: c, payload: f, stat: s, roi, wp, created: new Date(c.created_at || 0) * 1 };
            });
            if (sortHost) sortHost.querySelectorAll(".sort-pill").forEach(p => p.addEventListener("click", () => {
              sortHost.querySelectorAll(".sort-pill").forEach(q => { q.classList.remove("bg-white/10","text-slate-200"); q.classList.add("text-slate-400"); });
              p.classList.add("bg-white/10","text-slate-200"); p.classList.remove("text-slate-400");
              SAVED_SORT = p.dataset.sort || "recent";
              refreshSavedDashboard();
            }, { once: true }));
            const cmpMap = {
              recent: (a,b) => b.created - a.created,
              roi:    (a,b) => b.roi - a.roi,
              winpct: (a,b) => (isNaN(b.wp)?-1:b.wp) - (isNaN(a.wp)?-1:a.wp),
              bets:   (a,b) => b.stat.count - a.stat.count,
            };
            enriched.sort(cmpMap[SAVED_SORT] || cmpMap.recent);
            const bestRoi = enriched.reduce((m, x) => x.stat.count > 0 ? Math.max(m, x.roi) : m, -Infinity);
            const svgWinRing = (wp, size=28) => {
              if (isNaN(wp) || wp < 0) wp = 0; else if (wp > 100) wp = 100;
              const s = size, cx = s/2, cy = s/2, r = s/2 - 2.5;
              const c = 2*Math.PI*r, dash = (wp/100)*c;
              const color = wp >= 65 ? "#34d399" : wp >= 45 ? "#fbbf24" : "#fb7185";
              return `<svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" class="shrink-0">
                <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="2.5"/>
                <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="2.5" stroke-dasharray="${dash} ${c}" stroke-linecap="round" transform="rotate(-90 ${cx} ${cy})"/>
                <text x="${cx}" y="${cy + (s>24? 4 : 3.5)}" text-anchor="middle" font-size="${s>24?10:8}" font-family="ui-monospace,SFMono-Regular,Menlo,monospace" font-weight="700" fill="#e2e8f0">${isNaN(wp)?"—":Math.round(wp)+"%"}</text>
              </svg>`;
            };
            __savedRenderedAll = { enriched, svgWinRing, bestRoi, BASE };
            rerenderSavedFromCache();
          } catch (err) {
            if (strip) strip.innerHTML = `<div class="text-red-400">❌ Backend unreachable. Start backend: <span class="font-mono">cd backend && npm install && npm run dev</span><br><span class="text-[11px] text-slate-500 mt-2">${err.message}</span></div>`;
            list.innerHTML = "";
          }
        }
        function loadCardByToken(token) {
          if (!token) return;
          apiCall("GET", "/api/cards/share/" + encodeURIComponent(token)).then(data => {
            const raw = data?.card?.payload_json || data?.card?.payload || {};
            const payload = typeof raw === "string" ? JSON.parse(raw) : raw;
            const permalink = BASE + "/cards/" + encodeURIComponent(token);
            if (window.__creative?.enableShareButtons) window.__creative.enableShareButtons(permalink, payload);
            hydrateFromSavedPayload(payload);
            closeSaved();
          }).catch(err => {
            toast(`<span class="text-red-300">❌ Load failed: ${err.message}</span>`);
          });
        }
        function hydrateFromSavedPayload(p) {
          if (!p || typeof p !== "object") return;
          if (p.bankroll) { const br = document.getElementById("bankroll"); if (br) { br.value = p.bankroll; br.dispatchEvent(new Event("input", { bubbles: true })); } }
          if (p.probMode) {
            const r = document.querySelector(`input[name="probMode"][value="${p.probMode}"]`);
            if (r) { r.checked = true; r.dispatchEvent(new Event("change", { bubbles: true })); }
          }
          if (typeof p.mcEnabled === "boolean") {
            const mc = document.getElementById("mcToggle");
            if (mc && mc.checked !== !!p.mcEnabled) { mc.checked = !!p.mcEnabled; mc.dispatchEvent(new Event("change", { bubbles: true })); }
          }
          if (typeof p.oddsFormatAmerican === "boolean") {
            if (typeof oddsFormatAmerican !== "undefined") oddsFormatAmerican = !!p.oddsFormatAmerican;
            const tgl = document.getElementById("oddsFormatToggle");
            if (tgl && tgl.checked !== !!p.oddsFormatAmerican) { tgl.checked = !!p.oddsFormatAmerican; tgl.dispatchEvent(new Event("change", { bubbles: true })); }
            else if (typeof applyOddsFormatToAllCards === "function") { applyOddsFormatToAllCards(); }
          }
          const fightsArr = Array.isArray(p.fights) ? p.fights : [];
          if (!fightsArr.length) return;
          const fc = document.getElementById("fightCount");
          if (fc) {
            const n = Math.max(1, Math.min(5, fightsArr.length));
            fc.value = n;
            const evt = new Event("change", { bubbles: true });
            fc.dispatchEvent(evt);
          }
          setTimeout(() => {
            const mainCards = document.querySelectorAll('#fightsContainer .rounded-2xl.w-full');
            fightsArr.forEach((f, i) => {
              const mc = mainCards[i];
              if (!mc) return;
              const names = mc.querySelectorAll(".fighter-name");
              const odds = mc.querySelectorAll(".fighter-odds");
              const confs = mc.querySelectorAll(".fighter-confidence");
              const stats = mc.querySelectorAll(".fighter-status");
              (f.fighters || []).forEach((g, j) => {
                if (names[j] && typeof g.name === "string") { 
                  names[j].value = g.name; 
                  names[j].dispatchEvent(new Event("input", { bubbles: true })); 
                  names[j].dispatchEvent(new Event("blur", { bubbles: true })); 
                }
                if (odds[j]) {
                  const decVal = Number(g.odds) || 0;
                  if (Number.isFinite(decVal) && decVal > 1) odds[j].value = formatOddsDisplay(decVal);
                  odds[j].dispatchEvent(new Event("blur", { bubbles: true }));
                }
                if (confs[j]) { confs[j].value = Number(g.confidence) || 50; confs[j].dispatchEvent(new Event("input", { bubbles: true })); }
                if (stats[j]) stats[j].value = g.status || "NEUTRAL";
              });
            });
            // enable calc btn (re-validate)
            const vF = typeof validateConfig === "function" ? validateConfig() : true;
            const calc = document.getElementById("calcBtn");
            if (calc) calc.disabled = !vF;
            toast(`✅ Loaded ${fightsArr.length} fights from saved card. Click <b>Calculate Strategies</b> to re-run.`);
          }, 250);
        }
        // Try to auto-load from ?share= on page init
        async function tryAutoLoadFromShareParam() {
          try {
            const u = new URL(location.href);
            const s = u.searchParams.get("share");
            if (!s) return;
            const data = await apiCall("GET", "/api/cards/share/" + encodeURIComponent(s));
            const raw = data?.card?.payload_json || data?.card?.payload || {};
            const payload = typeof raw === "string" ? JSON.parse(raw) : raw;
            const permalink = BASE + "/cards/" + encodeURIComponent(s);
            if (window.__creative?.enableShareButtons) window.__creative.enableShareButtons(permalink, payload);
            setTimeout(() => hydrateFromSavedPayload(payload), 300);
          } catch (_) { /* ignore */ }
        }
        // Wire buttons
        if (SAVE_BTN) {
          SAVE_BTN.addEventListener("click", saveCard);
          // initially disabled until Build fights runs; hook enable via buildFights below.
        }
        if (OPEN_SAVED_BTN) OPEN_SAVED_BTN.addEventListener("click", openSaved);
        if (CLOSE_SAVED_BTN) CLOSE_SAVED_BTN.addEventListener("click", closeSaved);
        if (SAVED_MODAL) SAVED_MODAL.addEventListener("click", (e) => { if (e.target === SAVED_MODAL) closeSaved(); });
        // Re-expose for DOMContentLoaded init below.
        window.__backend = {
          enableSaveButton: () => { if (SAVE_BTN) { SAVE_BTN.disabled = false; SAVE_BTN.classList.remove("hidden"); } },
          tryAutoLoadFromShareParam,
        };
      })();

      // Init Sequence
      function startApp() {
          // 1. Initialize background particles and cursor immediately for a smooth start
          try {
              initBackgroundParticles();
              initCustomCursor();
          } catch (e) {
              console.warn("Background particles/cursor failed to init:", e);
          }

          // 2. Intro screen removal sequence
          // Shorten wait slightly to 1.8s for better perceived responsiveness
          setTimeout(() => {
              const loader = document.getElementById('intro-screen');
              if(loader) {
                  loader.classList.add('opacity-0', 'pointer-events-none');
                  // Completely remove from DOM after transition
                  setTimeout(() => { if(loader) loader.style.display = 'none'; }, 800);
              }
          }, 1800);

          // 3. Defer heavy DOM initialization to keep the intro animation smooth
          // We wait until the browser is idle or a sufficient delay has passed
          const initAppLogic = () => {
              try {
                  const startInit = performance.now();
                  buildFights();
                  if (window.__backend?.enableSaveButton) window.__backend.enableSaveButton();
                  if (window.__backend?.tryAutoLoadFromShareParam) window.__backend.tryAutoLoadFromShareParam();
                  logPerformance("Initial App Boot", startInit);
              } catch (e) {
                  console.error("Critical boot failure:", e);
                  // Force hide loader if something goes wrong
                  const loader = document.getElementById('intro-screen');
                  if(loader) loader.style.display = 'none';
              }
          };

          if (window.requestIdleCallback) {
              window.requestIdleCallback(() => setTimeout(initAppLogic, 300));
          } else {
              setTimeout(initAppLogic, 500);
          }
      }

      // Execute Init
      if (document.readyState === "loading") {
          document.addEventListener("DOMContentLoaded", startApp);
      } else {
          startApp();
      }
