Yes. Day 8–9 are closed. I checked the original plan against the material you have actually covered and against the course objectives. We should now switch modes: from “read everything carefully” to “learn the causal skeleton of each modern method, then move on.” The course explicitly expects deep value-based, policy-based, actor–critic, offline RL, OPE, stability, etc., so we cannot skip DQN—but we absolutely do not need another three-week chapter excavation. 

For Day 10 I am changing the original plan substantially. The original version had ~8 hours of lectures, Berkeley material, HW3, CartPole implementation, and debugging work.  That made sense for a leisurely first pass; it does not make sense now. You already did the hard prerequisite material: function approximation, semi-gradients, off-policy instability, the deadly triad, replay/planning intuition, and n-step methods.

## Day 10 — Deep Q-learning / DQN

Target: **~2.5–3 hours. No full DQN implementation today. No UniPD Lecture 15/16. No exercises.**

Your goal at the end is:

> “I can take one transition from a replay buffer, construct the DQN target, explain exactly why each DQN engineering trick exists, and say which offline-RL problems DQN does *not* solve.”

That is almost exactly the original stop condition. 

Do today in this order:

1. **15 min — closed-book bridge from Chapter 11.** On one page, write the ordinary approximate Q-learning update you already know:

   $$
   \delta=r+\gamma\max_{a'}Q_\theta(s',a')-Q_\theta(s,a)
   $$

   $$
   \theta\leftarrow\theta+\alpha\delta\nabla_\theta Q_\theta(s,a).
   $$

   Then write one sentence: “Why might replacing linear \(Q\) with a neural network be nasty?” You should immediately think: shared parameters, bootstrapping, off-policy data, correlated samples, changing data distribution. Do **not** derive anything.

2. **35–45 min — read only Sutton & Barto §16.5, the DQN case study.** This is the only actual reading I want from you today. Do not read the rest of Chapter 16. Focus only on the transition from approximate Q-learning to DQN: replay buffer, target network, network output structure, epsilon-greedy collection, and the target. The book explicitly describes DQN as semi-gradient Q-learning with a neural approximator, and notes that experience replay makes an off-policy method such as Q-learning a natural choice.  

3. **45–60 min — make a DQN mechanism note using the explanation below instead of reading UniPD/Berkeley.** I checked those lectures for you. The useful material is almost entirely the following causal chain. UniPD stresses that sequential RL samples are correlated and that control makes the distribution nonstationary; DQN stores transitions and later samples mini-batches from a replay buffer.   Berkeley adds one particularly useful interpretation: DQN is not “ordinary regression”; the Bellman target itself moves, target networks deliberately slow this movement, and replay/fitted Q-learning controls how much computation is spent per collected datum. 

   Start from one sampled transition

   $$
   (s,a,r,s',d)\sim\mathcal D.
   $$

   The **online/current network** is

   $$
   Q_\theta(s,a).
   $$

   A vanilla neural Q-learning target would be

   $$
   y=r+\gamma(1-d)\max_{a'}Q_\theta(s',a').
   $$

   and the loss would be

   $$
   L(\theta)=
   \frac12\left(Q_\theta(s,a)-y\right)^2.
   $$

   This should look extremely familiar. It is Chapter 10/11 Q-learning with \(Q\) represented by a neural network.

   But there is a nasty feedback loop:

   $$
   \theta\text{ changes}
   \Rightarrow Q_\theta(s,a)\text{ changes}
   $$

   while simultaneously

   $$
   \theta\text{ changes}
   \Rightarrow Q_\theta(s',a')\text{ changes}
   \Rightarrow y\text{ changes}.
   $$

   In supervised learning, you normally move your prediction toward a reasonably fixed label. Here you move the prediction **and move its label with the same parameter vector**.

   So DQN introduces a second, slowly changing parameter vector:

   $$
   \theta^-.
   $$

   Now:

   $$
   \boxed{
   y=
   r+\gamma(1-d)\max_{a'}Q_{\theta^-}(s',a')
   }
   $$

   while we optimize

   $$
   Q_\theta(s,a).
   $$

   Crucially:

   $$
   \boxed{\text{no gradient through }y}.
   $$

   This is the neural-network incarnation of the **semi-gradient** idea you already spent a lot of effort understanding in Chapter 9. Berkeley explicitly emphasizes “no gradient through target value.” 

   Every \(C\) steps we might do

   $$
   \theta^-\leftarrow\theta,
   $$

   or use Polyak averaging. UniPD presents exactly this motivation: bootstrapping makes targets move, and a target network reduces the rate at which they move. 

   The **replay buffer** solves a different problem. We collect

   $$
   \mathcal D=\{(s_i,a_i,r_i,s_i')\}
   $$

   over interaction and sample random mini-batches later.

   Why?

   Consecutive observations such as

   $$
   S_t,S_{t+1},S_{t+2},\ldots
   $$

   are strongly correlated. SGD behaves much more nicely when batches are less correlated. Replay mixes transitions from different moments and also permits reusing the same transition multiple times. UniPD explicitly gives both motivations. 

   But keep a thesis-important warning in huge letters:

   $$
   \boxed{\text{replay does NOT create coverage}}
   $$

   Randomly resampling a dataset containing no examples of some action does not magically tell you what that action does. This becomes one of the central reasons naïve Q-learning becomes dangerous in offline RL.

   Finally, **Double DQN** addresses another issue: the same noisy estimates are being used both to choose

   $$
   \arg\max_{a'}Q(s',a')
   $$

   and to evaluate that chosen action. Max tends to select actions with positive estimation errors, creating maximization/overestimation bias. You already saw the tabular version in Chapter 6. Deep Double Q-learning separates selection and evaluation approximately:

   $$
   a^*=
   \arg\max_{a'}Q_\theta(s',a'),
   $$

   $$
   y=
   r+\gamma
   Q_{\theta^-}(s',a^*).
   $$

   Do not derive the bias mathematically today. Understanding this mechanism is enough; later TD3 will reuse essentially the same concern about optimistic critic error. The course material explicitly connects Double Q to DQN, and later TD3 to the same overestimation problem.  

4. **20 min — manually trace exactly one transition.** Make up something tiny:

   $$
   r=2,\quad \gamma=.9,\quad d=0,
   $$

   and suppose your target network predicts

   $$
   Q_{\theta^-}(s',\cdot)=[3,5,1].
   $$

   Then calculate \(y\), calculate the TD error for some \(Q_\theta(s,a)\), and say precisely which network receives the optimizer update. Then repeat with \(d=1\). If terminal masking is understood, the second target becomes simply \(y=r\).

5. **20–30 min — final “research card.”** No prose essay. Put DQN in the middle and connect:

   $$
   \text{Q-learning}
   \rightarrow
   \text{NN function approximation}
   \rightarrow
   \boxed{\text{DQN}}
   $$

   with four branches: replay buffer → correlations/data reuse; target network → moving bootstrap target; Double DQN → maximization bias; epsilon-greedy → data collection/exploration. Then underneath write:

   $$
   \textbf{NOT SOLVED:}
   \quad
   \text{coverage, extrapolation/OOD actions, deadly-triad guarantees}.
   $$

   This distinction is especially important for where we are going: modern offline methods are commonly built on existing off-policy deep-RL algorithms, but have to add mechanisms specifically because ordinary off-policy deep RL does not handle the fixed-dataset distribution-shift problem. 

Do **not** today: review generic neural-network material; derive backpropagation; implement Atari; complete Berkeley HW3; tune CartPole; read the original DQN paper deeply; derive Double-Q bias; study prioritized replay/distributional DQN/Rainbow.

I am deliberately cutting those. Your official objectives require you to understand deep value methods and their stability challenges, but our scarce time is better spent soon on **PPO → TD3/SAC → offline RL → OPE**, which are much closer to your thesis and approved project.  The lectures themselves treat target networks, replay, Double Q and related improvements as the key DQN machinery. 

One extra thing I want you to notice today because it will matter enormously later: Berkeley describes an **update-to-data ratio (UTD)**—how many optimization updates you do per new piece of experience. More reuse can make learning faster, but too much reuse can produce overfitting-like pathologies; they explicitly foreshadow this as relevant to offline RL.  Keep that idea. Do not dig into it yet.

So: **open Sutton §16.5 now.** Read with your usual annotations, but obey one rule today: if you encounter a formula that is not necessary to explain one of the mechanisms above, mark `?` and continue instead of stopping. Send me all the questions afterward in one batch, and we'll close Day 10 in one tutor pass rather than spawning another Chapter-7-sized investigation.
