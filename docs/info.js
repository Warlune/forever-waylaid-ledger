(function () {
  'use strict';

  const LINK = 'target="_blank" rel="noopener noreferrer"';

  window.InfoTab = {
    render(faction = 'horde') {
      const alliance = faction === 'alliance';
      const factionName = alliance ? 'Azeroth Commerce Authority' : 'Durotar Supply and Logistics';
      const factionId = alliance ? 2586 : 2587;
      const crateNpc = alliance ? 'Marcy Baker' : 'Dokimi';
      const crateLocation = alliance
        ? 'at the Alliance trade hub at Three Corners in Redridge Mountains, approximately <code>/way 9.6 70.9</code>'
        : 'at the Horde trade hub west of the Crossroads in The Barrens, approximately <code>/way 50 29</code>';
      const questId = alliance ? 98247 : 98248;
      const signId = alliance ? 270888 : 270887;
      const signName = alliance ? 'Dwarven sign license' : 'Orcish sign license';
      const tabardId = alliance ? 262765 : 262764;
      return `
        <div class="info-tab-content">
          <div class="info-intro">
            <div>
              <p class="info-kicker">${alliance ? 'ALLIANCE' : 'HORDE'} TURN-IN GUIDE · FOREVER BETA</p>
              <h2>Favor buys the goods. Reputation opens the doors.</h2>
              <p>Both come from the ${factionName} trade network, but they are different rewards. Use the Crates and Writs tabs to compare gold costs for each path.</p>
            </div>
            <a class="info-source-chip" href="https://www.wowhead.com/forever/faction=${factionId}" ${LINK}>Faction record ↗</a>
          </div>

          <div class="info-loop" aria-label="How the two turn-in paths work">
            <article class="info-path info-path-favor">
              <div class="info-path-top"><span class="info-path-icon" aria-hidden="true">▣</span><span class="info-path-label">WAYLAID CRATES</span><strong>Merchant's Favor</strong></div>
              <p>Fill a crate with <b>one</b> of its listed bundles, then hand the sealed crate to <b>${crateNpc}</b> ${crateLocation}. Spend Favor on profession recipes and other trade-post rewards.</p>
              <span class="info-path-foot">Regular crate turn-ins currently show Favor, with no repeatable reputation reward documented.</span>
              <a href="https://www.wowhead.com/forever/currency=3402/merchants-favor" ${LINK}>Merchant's Favor ↗</a>
            </article>
            <article class="info-path info-path-rep">
              <div class="info-path-top"><span class="info-path-icon" aria-hidden="true">✧</span><span class="info-path-label">CRAFTSMAN'S WRITS</span><strong>Faction reputation</strong></div>
              <p>Open a sealed writ, get the requested crafted goods, and <b>keep the writ in your bags</b>. Deliver both to the customer location marked on your quest map. Writ quests are marked <b>Daily</b>; each pays <b>75, 125, or 200</b> ${factionName} reputation.</p>
              <span class="info-path-foot">Writ deliveries can be away from the ${alliance ? 'Three Corners hub' : 'Crossroads'}. No Merchant's Favor is listed for them.</span>
              <a href="https://www.wowhead.com/forever/quest=94237/craftsmans-writ-crafted-solid-shot" ${LINK}>Example writ quest ↗</a>
            </article>
          </div>

          <div class="info-lower">
            <section class="info-card" aria-labelledby="info-first-title">
              <div class="info-card-head"><span class="info-step">01</span><h3 id="info-first-title">Your first delivery</h3></div>
              <p>The ${alliance ? 'Alliance' : 'Horde'} <b>Shipping Label</b> is a one-time introduction. Deliver it to <b>${crateNpc}</b> at the ${alliance ? 'Three Corners' : 'Barrens'} trade hub for <strong>2,000 reputation + 50 Merchant's Favor</strong>. The quest requires level 10. This reward is separate from the repeatable crate loop.</p>
              <a href="https://www.wowhead.com/forever/quest=${questId}/shipping-label" ${LINK}>Shipping Label quest ↗</a>
            </section>

            <section class="info-card" aria-labelledby="info-ranks-title">
              <div class="info-card-head"><span class="info-step">02</span><h3 id="info-ranks-title">Reputation milestones</h3></div>
              <p class="info-table-caption">Total reputation needed if starting at Neutral</p>
              <div class="info-ranks" role="table" aria-label="${factionName} reputation milestones from Neutral">
                <div role="row"><span role="cell">Friendly</span><strong role="cell">3,000</strong><small role="cell">—</small></div>
                <div role="row"><span role="cell">Honored</span><strong role="cell">9,000</strong><small role="cell"><a href="https://www.wowhead.com/forever/item=${signId}/advertising-license-application" ${LINK}>${signName} ↗</a></small></div>
                <div role="row"><span role="cell">Revered</span><strong role="cell">21,000</strong><small role="cell">—</small></div>
                <div role="row"><span role="cell">Exalted</span><strong role="cell">42,000</strong><small role="cell"><a href="https://www.wowhead.com/forever/item=${tabardId}" ${LINK}>Faction tabard ↗</a></small></div>
              </div>
            </section>
          </div>

          <p class="info-beta-note"><strong>Beta data:</strong> The 150 new writs in this ledger break down into 45 at 75 rep, 60 at 125 rep, and 45 at 200 rep. Other crate tier payouts and any server-scripted reputation rewards are not fully documented, so check the in-game reward preview before committing expensive materials. Season of Discovery used this faction name with different turn-in rules.</p>
        </div>`;
    }
  };
})();
