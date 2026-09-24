# Research scope and content decisions

Authored September 22–24, 2026 for the Day 12 task **Build an algorithm decision
matrix for DQN, PPO, DDPG, TD3, and SAC**. The learning hierarchy is an authored
synthesis, not a reproduction of any one paper's taxonomy.

## Personal course material used

- TORL Day 12 plan, task resources, saved notes, tutor answers, and follow-ups;
  especially the five-card answer and the TD3 card the learner preferred.
- Saved text annotations associated with the PPO, TD3, and SAC paper resources,
  plus the source context preserved in tutor discussions.
- Local UniPD Lecture 21–22 and Berkeley lecture material on policy gradients,
  actor-critic methods, and deterministic actor-critic learning.
- The earlier day plan and Sutton & Barto material for bandits, Bellman/DP, MC,
  importance sampling, TD, n-step returns, traces, and approximation.

This was a read-only review of tracker data. The map does not copy entire
conversations or reproduce annotations verbatim. Original annotated iCloud PDF
files were not readable from this session because macOS denied access. Saved
annotation text and discussions were available; original-paper formulas were
checked against public primary sources. Therefore this map does **not** claim
to transcribe every handwritten mark in those PDFs. Local source links return
the reader to the tracker copies for further inspection.

## Primary sources and boundaries

- [DQN, Nature 2015](https://www.nature.com/articles/nature14236): core replay and
  target-network algorithm, with Atari-specific preprocessing, clipped rewards,
  clipped TD-error derivative and optimizer choices separately identified.
- [PPO, 2017](https://arxiv.org/abs/1707.06347): Algorithm 1 and Eqs. 7, 9, 11–12,
  also checked against the local paper TeX. The map expands minibatch loops and
  labels optional implementation conventions rather than making them PPO's
  definition. Adaptive KL-penalty PPO is distinguished from PPO-Clip.
- [DDPG, 2015/ICLR 2016](https://arxiv.org/abs/1509.02971): Algorithm 1 and §3;
  actor/Q copies, replay, OU exploration, and separate actor/critic gradients.
- [DPG, 2014](https://proceedings.mlr.press/v32/silver14.html): theorem-level
  occupancy assumptions distinguished from replay-based practical gradients.
- [TD3, ICML 2018](https://proceedings.mlr.press/v80/fujimoto18a.html): §§4–6,
  Algorithm 1, Figure 3 and ablations. One final actor, Q1 actor objective,
  minimum in the target, smoothing noise, and delayed actor/target copies.
- [SAC, ICML 2018](https://proceedings.mlr.press/v80/haarnoja18b.html): soft policy
  iteration, Eqs. 5–13, Algorithm 1, the practical twin-Q extension, and the
  squashed-policy appendix. This version learns V and a target V.
- [SAC Algorithms and Applications, 2018](https://arxiv.org/abs/1812.05905): a
  separately labeled later node with target Q networks and automatic temperature.
- Additional primary TRPO, GAE, Double DQN, and A3C sources are attached to their
  individual nodes in the manifest.

The procedures preserve update structure at the algorithm level. Shared notation,
terminal masks, explicit action bounds, and practical network duplication are
called out where the map expands a paper's compact pseudocode. They are not a
byte-for-byte transcription or a complete experiment configuration.

## Questions deliberately carried into the map

- PPO: action held fixed versus changing probability; advantage sign; stale after
  first minibatch; clipping is not a hard ratio/KL bound; GAE versus optimization;
  shared network losses; actor-critic as a family versus A2C as a member.
- TD3: final one-actor design versus the intermediate two-actor discussion;
  target copies versus independent critics; why actor/target selection can be
  too similar; shared targets and correlated errors; min target versus Q1 actor;
  six parameter sets; target smoothing versus exploration; delay scope;
  proof-only gradient normalizers; fixed actor versus fixed critic; target rate
  τ versus discount γ; benchmark tables versus convergence claims.
- SAC: explicit V; the soft Q–V relationship; reverse-KL projection and why Z
  disappears from the actor derivative; fresh action versus replay action;
  both log-density derivative paths; tanh Jacobian; reward scale/temperature;
  theory assumptions versus neural approximation; original versus later SAC.
- Across methods: parameter gradient versus action derivative; frozen weights
  versus detached output; behavior versus target policy; off-policy versus
  offline; bootstrapping, replay, target copies and double estimation as distinct
  mechanisms. The toy gradient plot explicitly labels its illustrative scope.

## Intentional limits

The compact view prioritizes a few connections; expanding it reveals 27 nodes.
This is a retrieval aid, not a requirement to memorize every node. Earlier
methods are concise; the five Day 12 algorithms receive the deepest paper-level
coverage. A separate source trail and recall prompt let detail stay available
without being visible all at once. Future papers can be added with the documented
JSON/Markdown workflow. Links do not imply that every pair has a direct historical
lineage or that the papers prove stability of their neural implementations.
