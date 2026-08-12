
      self.onmessage = function(e) {
        const { fights, rows, bankroll, trials, taskType } = e.data;
        
        if (taskType === 'simulate') {
          const result = simulateStrategy(fights, rows, bankroll, trials);
          self.postMessage({ type: 'result', result });
        }
      };

      function simulateStrategy(fights, rows, bankroll, trials) {
        const results = [];
        const winners = fights.map((fight) => {
          // In worker, we expect pre-computed probabilities
          return { a: fight.a, b: fight.b };
        });
        
        for(let i=0; i<trials; i++) {
          const outcomes = {};
          winners.forEach((w, idx) => {
            const fightId = idx + 1;
            outcomes[fightId] = Math.random() < w.a.prob ? w.a.name : w.b.name;
          });
          
          let currentBankroll = bankroll;
          let totalStaked = 0;
          let totalReturn = 0;
          
          rows.forEach(bet => {
            totalStaked += bet.stake;
            const won = bet.picks.every(p => outcomes[p.fight] === p.name);
            if(won) {
              totalReturn += bet.stake * bet.combinedOdds;
            }
          });
          
          results.push(totalReturn - totalStaked);
        }
        
        results.sort((a, b) => a - b);
        const q = (p) => results[Math.floor(p * (results.length - 1))];
        return { 
          median: q(0.5), 
          p5: q(0.05), 
          p95: q(0.95), 
          drawdownProb: results.filter((x) => x < -0.3 * bankroll).length / results.length, 
          results 
        };
      }
    