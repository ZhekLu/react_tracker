Yes. Let’s close Day 5 properly. A lot of what looked like separate confusion here is actually the same three ideas recurring: what MC is averaging, how policy improvement works without a model, and what importance sampling does to trajectory distributions.

I’ll keep your IDs exactly.

### Q-001 · Why can weighted IS have vanishing variance even if the ratios have infinite variance?

This is very important for OPE.

Ordinary importance sampling is

[
\hat v_{\text{ord}}
===================

\frac1N
\sum_{i=1}^N
\rho_i G_i.
]

Even if (G_i) is bounded, (\rho_i) may be enormous because in sequential problems

[
\rho_i
======

\prod_t
\frac{\pi(A_t\mid S_t)}
{b(A_t\mid S_t)}.
]

Thus a single sample

[
\rho_iG_i
]

can be arbitrarily large. In Example 5.5 it even has an infinite second moment. The book summarizes ordinary IS as unbiased but potentially having infinite variance. 

Weighted IS instead uses

[
\hat v_{\text{WIS}}
===================

\frac{\sum_i\rho_iG_i}
{\sum_i\rho_i}.
]

Define normalized weights

[
w_i
===

\frac{\rho_i}{\sum_j\rho_j}.
]

Then

[
\hat v_{\text{WIS}}
===================

\sum_iw_iG_i
]

with

[
w_i\ge0,
\qquad
\sum_iw_i=1.
]

So when the book says “the largest weight on any single return is one,” it means the **normalized weight (w_i)**, not the raw importance ratio (\rho_i).

If returns lie in

[
G_i\in[G_{\min},G_{\max}],
]

then their weighted average must also lie there:

[
G_{\min}
\le
\hat v_{\text{WIS}}
\le
G_{\max}.
]

So an individual gigantic (\rho_i) cannot make the estimate become (10^9); it can at worst make that one sample temporarily receive weight near (1).

As more samples arrive, under the usual coverage/consistency conditions, no individual normalized weight remains dominant forever, and the estimator concentrates around (v_\pi). Thus its variance tends toward zero even though the raw (\rho)'s themselves can have infinite variance.

The trade-off is:

[
\boxed{\text{ordinary IS: unbiased, potentially enormous/infinite variance}}
]

[
\boxed{\text{weighted IS: finite-sample bias, usually much lower variance, consistent}}
]

This distinction is foundational for OPE.

---

### Q-002 · “Importance ratio has expected value 1” — why?

This tiny equation is extremely important, including for the control variate you are now studying.

For one time step,

[
\rho_t
======

\frac{\pi(A_t\mid S_t)}
{b(A_t\mid S_t)}.
]

Condition on

[
S_t=s.
]

Because (A_t) is actually sampled from (b),

[
\mathbb E_b[\rho_t\mid S_t=s]
=============================

\sum_a
b(a\mid s)
\frac{\pi(a\mid s)}
{b(a\mid s)}.
]

Cancel (b):

# [

# \sum_a\pi(a\mid s)

1.

]

Therefore:

[
\boxed{
\mathbb E_b[\rho_t\mid S_t]=1.
}
]

This requires the usual support condition wherever (\pi(a\mid s)>0).

This does **not** mean every ratio equals 1.

You might observe:

[
\rho_t=0,\quad0.1,\quad5,\quad100,\ldots
]

but averaged under the behavior distribution, it equals (1).

And this is exactly why ratios corresponding to actions occurring **after an already-observed reward** can sometimes be removed without changing expectation. Section 5.9 explicitly uses this fact. 

Also:

[
\boxed{\mathbb E[\rho]=1}
]

does not imply low variance. Example 5.5 is the dramatic counterexample.

---

### Q-003 · Discounting as “degree of termination”

This is starred material. Understand this idea; do not spend hours on it.

Sutton & Barto give an alternative interpretation of discounting.

Normally:

[
G_t
===

R_{t+1}
+
\gamma R_{t+2}
+
\gamma^2R_{t+3}
+\cdots.
]

Imagine instead a fictitious process where after each reward:

[
1-\gamma
]

is the “degree/probability of termination,” while

[
\gamma
]

is the degree of continuing.

So termination immediately after the first reward has weight:

[
1-\gamma.
]

To terminate after the second reward, you must:

1. survive the first opportunity: (\gamma);
2. terminate at the second: (1-\gamma).

Thus:

[
\boxed{
\gamma(1-\gamma).
}
]

For the third:

[
\boxed{
\gamma^2(1-\gamma).
}
]

Generally, pseudo-termination at horizon (h) receives:

[
\boxed{
(1-\gamma)\gamma^{h-t-1}.
}
]

And if we survive all pseudo-termination points until the actual episode end (T), the remaining weight is

[
\boxed{
\gamma^{T-t-1}.
}
]

These weights form a probability-like decomposition and let the discounted return be rewritten as a mixture of **undiscounted partial returns**. That is what §5.8 exploits to truncate importance ratios appropriately. 

This will make Q-019/Q-020 much easier.

---

### Q-004 · Soap bubble example — what are they even solving?

You do **not** need the physics. Understand the RL analogy and move on.

Imagine a soap film stretched over a wire frame whose boundary has different heights.

We want:

[
u(x,y)
======

\text{height of the soap surface at each interior point}.
]

At equilibrium, an interior point's height is approximately the average of its nearby points. On a square grid:

[
\boxed{
u_{i,j}
=======

\frac14
\left(
u_{i+1,j}
+
u_{i-1,j}
+
u_{i,j+1}
+
u_{i,j-1}
\right).
}
]

Boundary heights are fixed by the wire.

That is mathematically a Bellman-like averaging equation.

The DP-style solution is:

Start with guesses for all interior grid values and repeatedly do

[
u_{i,j}
\leftarrow
\frac14
(u_{\text{north}}+u_{\text{south}}+u_{\text{east}}+u_{\text{west}})
]

until values stop changing.

The Monte Carlo solution is much more interesting.

Treat grid points as states. From any interior point, take a random step to one of its four neighbors:

[
P(\text{each direction})=\frac14.
]

Continue until you hit the boundary.

If the boundary point reached has height (H), treat (H) as the return.

Repeat many random walks from the same starting grid point:

[
H_1,H_2,\ldots,H_N.
]

Then:

[
\boxed{
u(s)\approx\frac1N\sum_iH_i.
}
]

In fact, the expected boundary height reached by the random walk solves the same averaging equations as the iterative method.

The conceptual RL mapping is therefore:

[
\text{interior grid point}\leftrightarrow S
]

[
\text{random neighbor transition}\leftrightarrow\text{policy/environment}
]

[
\text{boundary height}\leftrightarrow\text{return}
]

[
\text{surface height}\leftrightarrow v_\pi(s).
]

The reason the authors include it is to show a historical use of Monte Carlo: if you only need the value at one location, you can simulate random paths from there instead of solving the entire huge system. The book explicitly contrasts DP's full iterative calculation with MC's sampled trajectories. 

That level is enough.

---

### Q-005 · Exercise 5.3 — backup diagram for (q_\pi)

Your drawing has the correct **long sampled chain** idea.

The only correction is the root.

For (v_\pi(s)), the root is:

[
S_t.
]

For (q_\pi(s,a)), the thing being updated is the **state-action pair**:

[
(S_t,A_t).
]

Conceptually:

[
\boxed{
(S_t,A_t)
\to
R_{t+1},S_{t+1}
\to
A_{t+1}
\to
R_{t+2},S_{t+2}
\to\cdots\to
S_T.
}
]

There is no branching: Monte Carlo uses one sampled episode suffix all the way to termination.

In Sutton & Barto's backup-diagram notation, this means the root corresponds to the action node/state-action pair rather than merely a state node.

So: same long chain as your drawing, but make the updated object (Q(S_t,A_t)).

---

### Q-006 · MC policy iteration stopping condition

Your connection to policy iteration is correct, but separate **the ideal theorem** from **the actual MC ES algorithm**.

In exact policy iteration, given exact (q_{\pi_k}), define the next policy greedily:

[
\pi_{k+1}(s)
\in
\arg\max_a q_{\pi_k}(s,a).
]

Then for every state:

[
q_{\pi_k}(s,\pi_{k+1}(s))
\ge
q_{\pi_k}(s,\pi_k(s))
=====================

v_{\pi_k}(s).
]

If there is strict improvement somewhere, the new policy is better.

If no strict improvement exists anywhere, the current policy is already greedy with respect to its own value function, which implies optimality.

So conceptually:

[
\boxed{
\text{policy stable for every state}
\Rightarrow
\text{optimal}.
}
]

But ties matter. It is possible that

[
\pi_{k+1}(s)\neq\pi_k(s)
]

while both actions have equal maximal (q). Then the policy changed syntactically but did not improve in value; both may be optimal.

Now Monte Carlo ES.

It doesn't do:

> exactly evaluate all states → globally test policy equality → terminate.

Instead, episode by episode:

[
\text{sample episode}
\rightarrow
\text{update }Q\text{ for visited pairs}
\rightarrow
\text{make visited states greedy}.
]

It simply keeps looping.

And Sutton & Barto explicitly note something interesting: MC ES cannot settle permanently on a genuinely suboptimal policy, but full convergence of this exact algorithm was not formally established in their treatment. 

So:

[
\boxed{
\text{“no greedy improvement anywhere” is the theoretical fixed-point condition}
}
]

but it is not literally implemented as MC ES's `if stable: break`.

---

### Q-007 · Exercise 5.4 — incremental mean

Your proposed idea

[
Q\leftarrow Q+\frac{G}{N}
]

is not correct, because the old (Q) already contains the previous samples.

Suppose after (N-1) observations:

[
Q_{N-1}
=======

\frac{G_1+\cdots+G_{N-1}}{N-1}.
]

Then after new return (G_N),

[
Q_N
===

\frac{(N-1)Q_{N-1}+G_N}{N}.
]

Rearrange:

[
\boxed{
Q_N
===

Q_{N-1}
+
\frac1N
(G_N-Q_{N-1}).
}
]

So replace the stored list with:

[
N(S_t,A_t)\leftarrow N(S_t,A_t)+1,
]

[
\boxed{
Q(S_t,A_t)
\leftarrow
Q(S_t,A_t)
+
\frac{1}{N(S_t,A_t)}
[G-Q(S_t,A_t)].
}
]

This stores only count + mean rather than all previous returns. The MC ES pseudocode and motivation for this exercise are exactly as shown in the book. 

---

### Q-008 · Blackjack: are they really sticking at 13? And how did they get (v_*) from (Q)?

Yes — but **not for every dealer card**.

This graph is a function of the full blackjack state:

[
(\text{player sum},\text{dealer showing},\text{usable ace}).
]

For a hard 13 with no usable ace, the optimal policy sticks against sufficiently weak dealer cards, roughly the region you marked.

Why would 13 ever be enough?

Because the question isn't:

> Is 13 a good final hand?

It's:

> Is **hitting** better than letting the dealer play out?

Against a weak dealer card, the dealer has substantial bust probability. Meanwhile, from hard 13 a hit can itself bust you on sufficiently large cards.

So:

[
\text{bad hand}
]

does not imply:

[
\text{hit is better}.
]

The policy chooses the lesser risk.

With a usable ace, hitting is safer because the ace can switch from 11 to 1, which is why the upper policy behaves differently.

Now the caption:

> “The state-value function shown was computed from the action-value function.”

You asked how without knowing transition probabilities.

You don't need them.

Once MC has estimated:

[
Q(s,a)
]

and your final policy is deterministic greedy:

[
\pi_*(s)=\arg\max_aQ(s,a),
]

then:

[
\boxed{
V_*(s)
======

# Q(s,\pi_*(s))

\max_aQ(s,a).
}
]

No environment model required.

For a stochastic policy:

[
V_\pi(s)
========

\sum_a
\pi(a\mid s)Q_\pi(s,a),
]

where (\pi(a\mid s)) is known because **we define the policy**. Again, no (p(s',r\mid s,a)) is needed.

The book explicitly says Figure 5.2's state values were computed from the action-value function found by MC ES. 

---

### Q-009 · Eq. 5.2 — why subtract (\epsilon/|\mathcal A|), then divide by (1-\epsilon)?

This is a clever probability decomposition. Let's do it fully.

An (\epsilon)-soft policy satisfies:

[
\pi(a\mid s)
\ge
\frac{\epsilon}{|\mathcal A(s)|}.
]

Think of every action probability as consisting of two pieces:

[
\boxed{
\pi(a\mid s)
============

\underbrace{\frac{\epsilon}{|\mathcal A|}}*{\text{mandatory exploration}}
+
\underbrace{\text{remaining probability}}*{\text{total mass }1-\epsilon}.
}
]

So subtract the mandatory exploration part:

[
\pi(a\mid s)
------------

\frac{\epsilon}{|\mathcal A|}.
]

How much mass is left across all actions?

[
\sum_a
\left[
\pi(a\mid s)
------------

\frac{\epsilon}{|\mathcal A|}
\right]
]

# [

1-\epsilon.
]

To turn the residual into a proper probability distribution, divide by (1-\epsilon):

[
\boxed{
w(a)
====

\frac{
\pi(a\mid s)-\epsilon/|\mathcal A|
}{
1-\epsilon
}.
}
]

Check:

[
w(a)\ge0,
]

and:

[
\sum_aw(a)=1.
]

So this ugly-looking expression is simply:

> the policy's probability distribution **after removing the mandatory uniform (\epsilon)-exploration and renormalizing what remains**.

Now why does it enter the proof?

Because:

[
\max_a q_\pi(s,a)
\ge
\sum_aw(a)q_\pi(s,a)
]

for any probability distribution (w).

An average cannot exceed the maximum.

Therefore:

[
\frac{\epsilon}{|\mathcal A|}
\sum_aq_\pi(s,a)
+
(1-\epsilon)\max_aq_\pi(s,a)
]

is at least

[
\frac{\epsilon}{|\mathcal A|}
\sum_aq_\pi(s,a)
+
(1-\epsilon)
\sum_aw(a)q_\pi(s,a).
]

Insert (w(a)), and the coefficients recombine to (\pi(a\mid s)), giving:

[
\sum_a\pi(a\mid s)q_\pi(s,a)
============================

v_\pi(s).
]

So the proof shows that the (\epsilon)-greedy policy is at least as good as the old arbitrary (\epsilon)-soft policy.

This is the entire point of the algebra.

---

### Q-010 · Modified-environment proof — do you need to derive it?

No. For your current path, understand the idea; don't memorize this derivation.

The problem is:

[
\epsilon>0
]

means we're **forbidden from becoming completely greedy**. We must keep some random action probability.

So what does “optimal” even mean within this restricted class?

The book invents an equivalent environment:

You select an intended action (a).

With probability

[
1-\epsilon,
]

the environment executes (a).

With probability

[
\epsilon,
]

it ignores you and uniformly chooses a random action.

Thus the effective transition model is

[
\tilde p(s',r\mid s,a)
======================

(1-\epsilon)p(s',r\mid s,a)
+
\frac{\epsilon}{|\mathcal A|}
\sum_{a'}
p(s',r\mid s,a').
]

Now you can use an ordinary deterministic greedy policy in this modified environment.

That is mathematically equivalent to using an (\epsilon)-greedy/(\epsilon)-soft policy in the original one.

At policy stability, the equation satisfied by (v_\pi) is exactly the Bellman optimality equation of that modified environment. Since the Bellman optimality equation has a unique solution:

[
v_\pi=\tilde v_*.
]

Therefore the stable (\epsilon)-greedy policy is optimal **among (\epsilon)-soft policies**.

That's all you need from this page.

It is a proof device, not a new algorithm.

---

### Q-011 · “Is the target policy deterministic for my thesis?”

Do **not** lock yourself into that assumption.

The textbook statement is about a common **control** setup:

[
\pi(s)
======

\arg\max_aQ(s,a),
]

so (\pi) is deterministic greedy, while (b) remains exploratory. The book explicitly points out that this is useful because off-policy methods separate the exploratory behavior policy from the potentially deterministic target. 

But OPE itself asks:

[
\text{evaluate some target policy }\pi.
]

That policy may be either:

[
\boxed{\text{deterministic}}
]

or:

[
\boxed{\text{stochastic}}.
]

For discrete actions, deterministic policies are perfectly normal.

For example:

[
\pi(a^*(s)\mid s)=1.
]

Then importance ratios are simple:

[
\rho_t=
\begin{cases}
1/b(A_t\mid S_t), & A_t=a^*(S_t),\
0, & \text{otherwise}.
\end{cases}
]

But this can cause high variance because most behavior trajectories may suddenly get zero weight.

For continuous actions there is an additional major problem: a perfectly deterministic target policy corresponds mathematically to a point mass/Dirac distribution. Ordinary density-ratio IS against a continuous stochastic behavior policy can become ill-behaved or undefined in the usual form.

So for offline/OPE work:

[
\boxed{
\text{target policy is not inherently deterministic}.
}
]

You should always ask:

1. What exactly is the target policy?
2. Can I evaluate (\pi(a\mid s))?
3. Does the logged behavior have adequate support/coverage for it?

That question is much more important than “deterministic or stochastic?”

---

### Q-012 · Exercise 5.5 — first-visit vs every-visit

Your answer is exactly right.

The state occurs ten times in the observed 10-step episode, and because every reward is (+1),

[
G_0=10,\quad
G_1=9,\quad
\dots,\quad
G_9=1.
]

First-visit MC takes only the return following the first visit:

[
\boxed{
V_{\text{first}}(s)=10.
}
]

Every-visit MC averages all ten:

[
V_{\text{every}}(s)
===================

\frac{10+9+\cdots+1}{10}
]

# [

\frac{55}{10}
]

[
\boxed{=5.5.}
]

Notice that (p) is not needed to answer what the estimator is **after this particular observed episode**.

For reference, the actual true value of this one-state MDP is:

[
v(s)
====

1+pv(s)
]

because after one (+1), with probability (p) you're back where you started.

Thus:

[
\boxed{
v(s)=\frac{1}{1-p}.
}
]

But that is a different question from what the exercise asks.

---

### Q-013 · Why is (v_\pi(s)=1) in Example 5.5?

Because under the **target policy**, every episode eventually obtains exactly one (+1).

Target:

[
\pi(\text{left}\mid s)=1.
]

Every left action does one of two things:

[
0.9:
\quad
s\xrightarrow{R=0}s
]

or

[
0.1:
\quad
s\xrightarrow{R=+1}\text{terminal}.
]

The probability that you loop forever is

[
\lim_{n\to\infty}0.9^n=0.
]

So with probability 1, eventually you take a left transition that terminates and gives (+1).

All earlier rewards are zero.

And (\gamma=1).

Therefore every target-policy trajectory has:

[
G=0+0+\cdots+1=1.
]

Hence:

[
\boxed{
v_\pi(s)=\mathbb E_\pi[G]=1.
}
]

The behavior policy sometimes takes right and gets return (0), but those are **behavior trajectories**, not what (v_\pi) means. Importance sampling is precisely trying to use those behavior-generated observations to recover the target-policy expectation. The book states the target value is 1 in this example. 

---

### Q-014 · Where do those gigantic spikes come from?

This is one of the most important figures in Chapter 5.

Suppose a behavior trajectory takes left (L) times in a row and the final left terminates.

Target policy:

[
\pi(L\mid s)=1.
]

Behavior:

[
b(L\mid s)=\frac12.
]

Therefore each action contributes ratio

[
\frac1{1/2}=2.
]

For an (L)-step all-left trajectory:

[
\boxed{
\rho=2^L.
}
]

Its return is:

[
G=1.
]

So the ordinary IS sample is:

[
\boxed{
\rho G=2^L.
}
]

For example:

[
L=5\Rightarrow32
]

[
L=10\Rightarrow1024
]

[
L=20\Rightarrow1{,}048{,}576.
]

Such long all-left episodes are rare — but when one appears, the running sample mean gets smashed upward.

Then many ordinary episodes arrive whose contribution is zero or modest, so the running average slowly falls again.

Eventually another rarer, longer all-left episode appears and:

[
\text{BANG}
]

another spike.

We can even connect this directly to the infinite variance calculation.

A successful all-left trajectory of length (L) has behavior probability:

[
P_b(L)
======

(0.5\cdot0.9)^{L-1}(0.5\cdot0.1)
]

# [

0.05(0.45)^{L-1}.
]

But its squared IS sample is:

[
(2^L)^2=4^L.
]

So the second-moment contributions scale approximately as:

[
0.45^L4^L
=========

1.8^L.
]

And:

[
\sum_L1.8^L=\infty.
]

That is why those spikes never become a benign finite-variance noise process. 

---

### Q-015 · Your Exercise 5.7 / 5.8 notes

For **Exercise 5.7**, your “maybe rare events / IS ratios?” instinct is adjacent, but the cleanest explanation of Figure 5.3 is simpler.

The true blackjack state value is about

[
-0.277.
]

The estimators start at

[
0.
]

That is already fairly close:

[
(0-(-0.277))^2\approx0.077.
]

Weighted IS may initially have very few target-consistent trajectories. When its first effective sample arrives, its normalized estimate can jump dramatically toward that single realized return:

[
-1,;0,;\text{or }+1.
]

For example, if it jumps to (+1):

[
(1+0.277)^2\approx1.63,
]

much worse than the initial error.

As more usable returns accumulate, averaging dominates and the estimator converges back toward the true value.

Thus:

[
\boxed{
\text{fortunate initialization}
\rightarrow
\text{noisy early normalized samples}
\rightarrow
\text{initial error increase}
\rightarrow
\text{eventual concentration}.
}
]

For **Exercise 5.8**, your conclusion “yes, still infinite” is correct, but not because “we just average more terms of the same variance.”

The stronger reason is that every-visit MC still contains the pathological long-return contributions that caused the first-visit estimator's infinite second moment.

I give the more detailed proof under Q-017 below.

The book places Exercises 5.7 and 5.8 specifically after the infinite-variance example to probe these distinctions. 

---

### Q-016 · Exercise 5.6 — should the ratio start at (t)?

No. It starts at:

[
\boxed{t+1}.
]

For state values:

[
v_\pi(s)
========

\mathbb E_\pi[G_t\mid S_t=s].
]

(A_t) is still random under (\pi), so state-value IS needs to correct it.

For action values:

[
q_\pi(s,a)
==========

\mathbb E_\pi[
G_t
\mid
S_t=s,A_t=a
].
]

The current action is already conditioned upon.

We are asking:

> Given that action (a) was taken now, what is the expected return if we follow (\pi) afterward?

So we do not correct (A_t).

Only:

[
A_{t+1},A_{t+2},\ldots,A_{T-1}
]

must behave like (\pi).

Therefore the weighted estimator analogous to (5.6) is:

[
\boxed{
Q(s,a)
======

\frac{
\sum_{t\in\mathcal T(s,a)}
\rho_{t+1:T(t)-1}G_t
}{
\sum_{t\in\mathcal T(s,a)}
\rho_{t+1:T(t)-1}
}.
}
]

with

[
\rho_{t+1:T-1}
==============

\prod_{k=t+1}^{T-1}
\frac{\pi(A_k\mid S_k)}
{b(A_k\mid S_k)}.
]

This is exactly the same conditioning principle you've now encountered again in Chapter 7.

---

### Q-017 · Is infinite variance always like Example 5.5? Are (\pi) and (b) “incompatible”?

No — and this is a very important distinction.

The policies in Example 5.5 are actually **compatible in the support sense**.

Target:

[
\pi(L\mid s)=1.
]

Behavior:

[
b(L\mid s)=0.5.
]

Since:

[
\pi(L\mid s)>0
\Rightarrow
b(L\mid s)>0,
]

coverage holds.

There is no division by zero.

So:

[
\boxed{
\text{support is satisfied}.
}
]

The problem is instead **bad overlap + multiplicative horizon**.

Each matching action contributes:

[
2.
]

Across (L) actions:

[
2^L.
]

Rare long trajectories therefore obtain enormous weights.

You can even see exactly when this example would stop having infinite variance.

Suppose generally:

[
b(L\mid s)=q
]

and the probability that a left action loops back is:

[
p.
]

For a long target-compatible trajectory, approximately:

[
P_b(L\text{ steps})
\propto
(qp)^L.
]

Importance weight:

[
\rho\propto q^{-L}.
]

Squared:

[
\rho^2\propto q^{-2L}.
]

Multiply occurrence probability by squared weight:

[
(qp)^Lq^{-2L}
=============

\left(\frac pq\right)^L.
]

The second-moment series behaves like:

[
\sum_L
\left(\frac pq\right)^L.
]

It diverges when roughly:

[
\boxed{p/q\ge1.}
]

In the textbook:

[
p=0.9,\qquad q=0.5,
]

so:

[
\frac pq=1.8>1.
]

Hence divergence.

If behavior selected left extremely often, say

[
q=0.95,
]

then

[
p/q<1
]

and this particular second moment would be finite.

So:

[
\boxed{
\text{importance sampling does not always have infinite variance}.
}
]

The real lesson is:

[
\boxed{
\text{support}
\neq
\text{good statistical overlap}.
}
]

The book's example deliberately has valid support but nevertheless infinite variance. 

That is one of the most thesis-relevant facts in this chapter.

Now every-visit MC.

For an all-left episode of length (L), every-visit contributions include suffix weights roughly:

[
2^L,2^{L-1},\ldots,2.
]

Their sum is:

[
2+4+\cdots+2^L
==============

2^{L+1}-2.
]

So the episode still contributes something growing exponentially as

[
O(2^L).
]

Its squared contribution is therefore still

[
O(4^L),
]

while occurrence probability decays only roughly as

[
0.45^L.
]

Thus:

[
0.45^L4^L=1.8^L,
]

and the second moment still diverges.

So every-visit does **not** cure the heavy tail.

---

### Q-018 · Exercise 5.12 Racetrack — should you do it?

No, not now.

It is a substantial programming exercise designed to practice MC control, state representation, exploration, and episodic simulation.

Those are useful skills, but this exercise does not close a conceptual hole that you currently need for Sections 7.3–7.4 or OPE.

Your Day 5 plan explicitly prioritizes Exercises 5.3, 5.5, 5.6, 5.10 and later textbook reproductions rather than completing every exercise. 

So:

[
\boxed{\text{5.12 Racetrack: PARK.}}
]

Return only if later you specifically want another MC-control implementation benchmark.

---

### Q-019 · Discounting-aware IS — why are there all these (h)'s? Shouldn't we “cut it off”?

This notation is horrible until you see what (h) means.

(h) is **not another time step that all belongs to one return**.

Each (h) represents a different hypothetical stopping horizon.

Define the flat, undiscounted partial return:

[
\bar G_{t:h}
============

R_{t+1}
+
R_{t+2}
+\cdots+
R_h.
]

Then the ordinary discounted return can be rewritten as a mixture of different partial returns.

Take a tiny example with three rewards remaining:

[
G_t
===

R_{t+1}
+
\gamma R_{t+2}
+
\gamma^2R_{t+3}.
]

The book's decomposition is:

[
\boxed{
G_t
===

(1-\gamma)\bar G_{t:t+1}
+
(1-\gamma)\gamma\bar G_{t:t+2}
+
\gamma^2\bar G_{t:t+3}.
}
]

Expand it:

[
(1-\gamma)R_{t+1}
]

[
+
(1-\gamma)\gamma
(R_{t+1}+R_{t+2})
]

[
+
\gamma^2
(R_{t+1}+R_{t+2}+R_{t+3}).
]

Collect coefficient on (R_{t+1}):

[
(1-\gamma)
+
(1-\gamma)\gamma
+
\gamma^2
========

1.

]

Coefficient on (R_{t+2}):

[
(1-\gamma)\gamma+\gamma^2
=========================

\gamma.
]

Coefficient on (R_{t+3}):

[
\gamma^2.
]

So we reconstruct exactly:

[
R_{t+1}
+
\gamma R_{t+2}
+
\gamma^2R_{t+3}.
]

That's why we sum over multiple (h)'s.

We **are** cutting each individual partial return off:

[
\bar G_{t:h}
]

contains nothing after (h).

But then we average over different possible (h)'s.

And because (\bar G_{t:h}) only depends on actions through (h-1), it only needs:

[
\boxed{\rho_{t:h-1}}
]

rather than the full trajectory ratio.

That is the variance-reduction motivation behind the section. 

This is basically a precursor to the per-decision idea you're now studying in 7.4.

---

### Q-020 · Why is the final full-return term in Eq. 5.10 separate?

The circled term is essential:

[
\gamma^{T-t-1}
\rho_{t:T-1}
\bar G_{t:T}.
]

Recall the pseudo-termination interpretation.

Before the actual terminal time (T), you have possible pseudo-termination horizons with weights:

[
(1-\gamma),
]

[
\gamma(1-\gamma),
]

[
\gamma^2(1-\gamma),
]

etc.

But there is also the possibility:

> none of the pseudo-terminations happens before the real terminal state.

The weight of surviving all those opportunities is:

[
\boxed{
\gamma^{T-t-1}.
}
]

That is exactly the final term.

For example, with three rewards:

[
(1-\gamma)
+
\gamma(1-\gamma)
+
\gamma^2
========

1.

]

If you deleted the final term, total mixture weight would be:

[
1-\gamma^2<1.
]

Worse, the final reward (R_T) would have **no term at all** through which it could enter the return.

So the final term means:

[
\boxed{
\text{“we never pseudo-terminated early, so use the entire real episode.”}
}
]

The strongest sanity check is:

[
\gamma=1.
]

Then:

[
1-\gamma=0,
]

so the entire big sum of shorter partial returns disappears.

Only:

[
\gamma^{T-t-1}
\rho_{t:T-1}
\bar G_{t:T}
============

\rho_{t:T-1}G_t
]

remains.

And that is exactly the ordinary full-trajectory importance-sampling estimator from §5.5, which the book notes explicitly. 

For your current learning path, Q-019/Q-020 are enough. I would not further derive §5.8. The more important continuation is §5.9 → §7.4: once you understand that **information occurring earlier in a trajectory should not unnecessarily inherit randomness from later importance ratios**, you have extracted the part that matters downstream.
