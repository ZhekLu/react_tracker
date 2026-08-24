Yes. For these six I’ll explicitly tell you what is worth mastering versus what is only worth understanding once and moving on from.

Also, your instinct is right: §5.8 is much less important than §5.9 for your path. Your original plan actually excluded §5.8 and explicitly included §5.9; that was a good prioritization.

### Q-056 · Eq. 5.9 — what is that separate final term?

**Priority: LOW. Understand the reason once; do not memorize Eq. 5.9.** The circled term is

$$
\gamma^{T(t)-t-1}
\rho_{t:T(t)-1}
\bar G_{t:T(t)}.
$$

It exists because the decomposition before it considers lots of **possible artificial stopping horizons** $h=t+1,t+2,\ldots,T-1,$ but there is also one final possibility: “we never “stop early” and instead reach the actual end of the episode $T$.” That possibility gets the leftover weight $\gamma^{T-t-1}.$ Think of the weights as: $1-\gamma$ for stopping after the first reward, $\gamma(1-\gamma)$ for surviving once and stopping after the second, $\gamma^2(1-\gamma)$ for surviving twice and stopping after the third, and so on. Eventually there is the case:

$$
\boxed{\text{survive every artificial stop until the real terminal state}}
$$

whose probability-like weight is

$$
\boxed{\gamma^{T-t-1}}.
$$

That is the circled term. For example, suppose only three rewards remain: $R_1,R_2,R_3.$ The mixture weights are

$$
(1-\gamma),
\qquad
\gamma(1-\gamma),
\qquad
\gamma^2.
$$

Check that they sum to one: $(1-\gamma)+\gamma(1-\gamma)+\gamma^2$

$$
= 1-\gamma+\gamma-\gamma^2+\gamma^2 = 1.
$$

If we deleted the final $\gamma^2$ term, we would have only $1-\gamma^2$ total weight, and $R_3$ would never enter any partial return at all. The same construction appears in the book's discounting-aware IS estimator: all partial returns up to (T-1) get the $(1-\gamma)\gamma^{h-t-1}$ weights, and the full episode gets the final leftover $\gamma^{T-t-1}$ term. Sanity check: If $\gamma=1,$ then every term multiplied by $1-\gamma$ disappears, and the final term remains: $\rho_{t:T-1}\bar G_{t:T}.$ Since with $\gamma=1$, $\bar G_{t:T}=G_t,$ we get ordinary full-trajectory IS again.

So this final term is not an annoying correction. It is just the **“didn't stop early” remainder**.

---

### Q-057 · Where did $(1-\gamma)$ come from in the return decomposition?

**Priority: LOW–MEDIUM. The algebra is useful once, but the formula itself is not something I want you memorizing.** This expression initially looks as though Sutton & Barto pulled $(1-\gamma)$ out of nowhere:

$$
G_t = (1-\gamma)R_{t+1} + (1-\gamma)\gamma(R_{t+1}+R_{t+2}) + \cdots
$$

They didn't start from $R_{t+1}=(1-\gamma)R_{t+1}.$ That would obviously be false. Instead, they are rewriting the **whole discounted sum** in a different basis. Let's use only three rewards. Start from the ordinary return:

$$
\boxed{
G = R_1+\gamma R_2+\gamma^2R_3.
}
$$

They claim this is equal to

$$
(1-\gamma)R_1 + (1-\gamma)\gamma(R_1+R_2) + \gamma^2(R_1+R_2+R_3).
$$

Let's expand the right side: $(1-\gamma)R_1$; $+\gamma(1-\gamma)R_1 + \gamma(1-\gamma)R_2$; $+\gamma^2R_1 + \gamma^2R_2 + \gamma^2R_3.$ Now collect coefficients. For $R_1$: $(1-\gamma) + \gamma(1-\gamma) + \gamma^2.$ Expand: $1-\gamma+\gamma-\gamma^2+\gamma^2=1.$ So $R_1$ gets coefficient $1$. For $R_2$: $\gamma(1-\gamma)+\gamma^2$

$$
=\gamma-\gamma^2+\gamma^2 = \gamma.
$$

So $R_2$ gets coefficient $\gamma$. For $R_3$: $\gamma^2.$ Therefore: $R_1+\gamma R_2+\gamma^2R_3.$ Exactly the original return. So where did $1-\gamma$ “come from”? It was deliberately chosen because of the telescoping identity

$$
\boxed{
(1-\gamma)
\sum_{j=k}^{m-1}\gamma^{j-1} + \gamma^{m-1} = \gamma^{k-1}.
}
$$

ELI5 version: Instead of saying: “reward 1 gets weight 1, reward 2 gets weight $\gamma$, reward 3 gets weight $\gamma^2$,” we can say: “maybe the story “ends” after reward 1, maybe after reward 2, maybe after reward 3; average all those partial stories with carefully chosen weights.” And the carefully chosen “stop now” weight is $1-\gamma$. That is all §5.8 is doing.

---

### Q-058 · Exercise 5.13 — derive $5.14$ from $5.12$

**Priority: HIGH for your OPE/statistics foundation. Do this derivation once properly.** Yes, this exercise is worth doing. We want to understand why:

$$
\boxed{
\mathbb E_b[
\rho_{t:T-1}R_{t+1}
] = \mathbb E_b[
\rho_{t:t}R_{t+1}
].
}
\tag{5.14}
$$

In words: “Why can all the importance ratios **after time $t$** be discarded when estimating the expectation of $R_{t+1}$?” Equation 5.12 writes the left side sample as:

$$
\rho_{t:T-1}R_{t+1} = \frac{\pi(A_t|S_t)}{b(A_t|S_t)}
\frac{\pi(A_{t+1}|S_{t+1})}{b(A_{t+1}|S_{t+1})}
\cdots
\frac{\pi(A_{T-1}|S_{T-1})}{b(A_{T-1}|S_{T-1})}
R_{t+1}.
$$

Define: $\rho_t = \frac{\pi(A_t|S_t)}{b(A_t|S_t)}$ and put all later ratios into $M_{t+1} = \rho_{t+1}\rho_{t+2}\cdots\rho_{T-1}.$ Then: $\rho_{t:T-1}R_{t+1} = \rho_tR_{t+1}M_{t+1}.$ Now the key observation: By the time $R_{t+1}$ has happened, the future actions $A_{t+1},A_{t+2},\ldots$ have not happened yet. Those future ratios change **which future trajectories** count as target-policy-like, but they cannot causally affect the reward that has already occurred. Mathematically, the important result is:

$$
\boxed{
\mathbb E_b[M_{t+1}\mid \text{history through }S_{t+1}] = 1.
}
$$

Why? Start with one ratio:

$$
\mathbb E_b[\rho_k\mid S_k=s] = \sum_a
b(a|s)
\frac{\pi(a|s)}{b(a|s)}
$$

$$
= \sum_a\pi(a|s) = 1.
$$

But we must be slightly careful: the future ratios are not independent, because actions change later states. So the rigorous tool is the **law of iterated expectations / tower property**, not independence. Let $H_{t+1}$ denote everything known through $S_{t+1}$, including $R_{t+1}$. Then:

$$
\mathbb E[
\rho_tR_{t+1}M_{t+1}
]
$$

$$
= \mathbb E
\left[
\mathbb E[
\rho_tR_{t+1}M_{t+1}
\mid H_{t+1}
]
\right].
$$

At that point, $\rho_tR_{t+1}$ is already known, so pull it out:

$$
\mathbb E
\left[
\rho_tR_{t+1}
\mathbb E[
M_{t+1}\mid H_{t+1}
]
\right].
$$

And the future likelihood-ratio product has conditional expectation 1:

$$
\mathbb E[
\rho_tR_{t+1}\cdot1
].
$$

Thus:

$$
\boxed{
\mathbb E[
\rho_{t:T-1}R_{t+1}
] = \mathbb E[
\rho_tR_{t+1}
].
}
$$

That is Eq. 5.14. Why is $E[M_{t+1}|H_{t+1}]=1$ even for a whole sequence? You can strip ratios off recursively. At the last action: $E[\rho_{T-1}|S_{T-1}]=1.$ So remove it in expectation. Then remove $\rho_{T-2}$. Then $\rho_{T-3}$. Continue backward until only the ratios that occur **before the reward in question** remain. This gives the general result:

$$
\boxed{
E[
\rho_{t:T-1}R_{t+k}
] = E[
\rho_{t:t+k-1}R_{t+k}
].
}
$$

Meaning:

- $R_{t+1}$ needs only $\rho_t$;
- $R_{t+2}$ needs $\rho_t\rho_{t+1}$;
- $R_{t+3}$ needs $\rho_t\rho_{t+1}\rho_{t+2}$;
- etc.

This is exactly the mathematical foundation of **per-decision importance sampling**. Very important conceptual lesson:

$$
\boxed{
\text{unnecessary future likelihood ratios have expectation }1,
}
$$

so retaining them gives you no correction in expectation but can give you a lot of extra variance. That's an OPE principle worth keeping.

---

### Q-059 · Do you need §5.8 Discounting-aware IS for the thesis?

**Priority: LOW. Do not master this section.** No — not at the level at which you've been trying to understand it. And this is not merely because it is difficult. Sutton & Barto mark §5.8 with a star, and your study plan deliberately assigned:

$$
5.1-5.7
\quad\text{and}\quad
5.9,
$$

not 5.8. For your thesis/OPE path, extract exactly this one idea from §5.8:

$$
\boxed{
\text{the return has temporal structure, so we need not always apply the full trajectory IS ratio to every piece of it.}
}
$$

Discounting makes rewards farther in the future matter less, so it can be interpreted as a mixture over shorter effective horizons. Shorter pieces need shorter IS products. This can reduce variance. That is enough. You do **not** need to retain:

- Eq. 5.9;
- Eq. 5.10;
- the exact pseudo-termination derivation;
- the discounting-aware weighted denominator;
- implementation details of these estimators.

For your future work, much more important are:

$$
\boxed{\text{ordinary vs weighted IS}}
$$

$$
\boxed{\text{support vs statistical overlap}}
$$

$$
\boxed{\text{trajectory-weight explosion}}
$$

$$
\boxed{\text{per-decision IS (§5.9)}}
$$

$$
\boxed{\text{control variates (§7.4)}}
$$

and later

$$
\boxed{\text{FQE / doubly robust / coverage diagnostics}}.
$$

So after you understand Q-056/Q-057 conceptually, **close §5.8 and do not revisit its algebra unless a later estimator explicitly requires it**.

---

### Q-060 · Eq. 5.13–5.14 — where does $b(a|S_k)$ come from? Why is expectation 1?

**Priority: CORE. This one matters a lot.** Your screenshot asks where this came from:

$$
\mathbb E
\left[
\frac{\pi(A_k|S_k)}
{b(A_k|S_k)}
\right] = \sum_a
b(a|S_k)
\frac{\pi(a|S_k)}
{b(a|S_k)}.
$$

The $b(a|S_k)$ appears because:

$$
\boxed{A_k\text{ was sampled from the behavior policy }b.}
$$

Recall the basic expectation of a discrete random variable: If $X\sim p(x),$ then $E[f(X)] = \sum_xp(x)f(x).$ Here: $X=A_k,$ its distribution is $p(a)=b(a|S_k),$ and the function is

$$
f(a) = \frac{\pi(a|S_k)}
{b(a|S_k)}.
$$

Therefore:

$$
E_b[f(A_k)|S_k] = \sum_a
b(a|S_k)
\frac{\pi(a|S_k)}
{b(a|S_k)}.
$$

Cancel: $\sum_a\pi(a|S_k) = 1.$ So nothing mysterious happened. It is just:

$$
\boxed{
E[f(X)] = \sum_x P(X=x)f(x).
}
$$

For continuous actions, the same logic becomes an integral with the behavior density:

$$
\int
b(a|s)
\frac{\pi(a|s)}{b(a|s)}
,da = \int\pi(a|s),da = 1.
$$

The book uses exactly this argument in Eq. 5.13. You wrote something like: ““Why then $E[\pi/b]\neq0$?”” It should **not** be zero. It should be:

$$
\boxed{1}.
$$

And that is exactly the useful property. Why? Imagine multiplying some already-known number $X$ by a random future factor $Z$ with $E[Z]=1.$ Then, under the appropriate conditioning: $E[XZ]=E[X].$ So adding that future ratio does not change the mean. It merely injects randomness. For example, suppose a random factor is

$$
Z=
\begin{cases}
0 & \text{with probability }0.5\\
2 & \text{with probability }0.5.
\end{cases}
$$

Then: $E[Z]=1.$ If $X=10$, then (XZ) is either:

$$
0
\quad\text{or}\quad
20.
$$

Mean: $10.$ Same as $X$, but much noisier. That's essentially what §5.9 says about unnecessary future IS ratios:

$$
\boxed{
\text{same expectation, extra variance}.
}
$$

One subtlety: $X$ and future ratios are generally not independent. That's why the formal argument uses **conditional expectation / tower property**, as in Q-058.

---

### Q-061 · Eq. 5.15 — “Why are we averaging without weights? Don't we lose weighted IS's variance advantage?”

**Priority: HIGH. This distinction is useful for understanding OPE estimators.**

Yes: Eq. 5.15 is **not weighted importance sampling**. It is the **ordinary per-decision importance-sampling estimator**. That sounds contradictory because the new return $\tilde G_t$ already contains lots of importance weights inside it. But distinguish two completely separate things.

#### Mechanism A: importance correction inside each sample

Per-decision IS constructs something like

$$
\tilde G_t = \rho_tR_{t+1} + \gamma\rho_{t:t+1}R_{t+2} + \gamma^2\rho_{t:t+2}R_{t+3} + \cdots.
$$

So each reward is corrected using only the ratios necessary to convert its distribution from $b$ to $\pi$. That already gives us an unbiased sample target: $E_b[\tilde G_t\mid S_t=s] = v_\pi(s).$ Therefore if we collect $N$ such targets: $\tilde G_1,\ldots,\tilde G_N,$ the natural ordinary estimator is just their sample mean:

$$
\boxed{
V(s) = \frac1N\sum_i\tilde G_i.
}
$$

That is Eq. 5.15. The book says it has the same unbiased expectation as ordinary trajectory IS in the first-visit case and may have lower variance. So why lower variance if we didn't use weighted IS normalization? Because we have already done a **different kind of variance reduction**:

$$
\boxed{
\text{we deleted unnecessary future ratios from each reward}.
}
$$

That is mechanism A.

#### Mechanism B: weighted/self-normalized IS

Ordinary trajectory IS: $\frac1N\sum_i\rho_iG_i.$ Weighted IS instead does:

$$
\frac{\sum_i\rho_iG_i}
{\sum_i\rho_i}.
$$

This normalization is another variance-control mechanism. It gives finite-sample bias but often much better numerical behavior. So there are two independent ideas:

$$
\boxed{
\text{per-decision} = \text{shorter ratio products}
}
$$

versus

$$
\boxed{
\text{weighted IS} = \text{normalize weights across samples}.
}
$$

Eq. 5.15 uses the first but **not** the second. Therefore: ““Do all the lower-variance advantages disappear?”” No. You retain the variance reduction from removing irrelevant ratios. You simply do not get the additional self-normalization advantage of weighted IS. And this leads directly to the question Sutton & Barto ask below Eq. 5.15: “Is there a per-decision version of weighted importance sampling?” Their answer is essentially: “It is not straightforward.” Why? Because ordinary weighted IS has one clean trajectory weight: $\rho_i.$ Then normalizing it is obvious: $\frac{\rho_i}{\sum_j\rho_j}.$ But per-decision IS gives **different weights to different reward terms**: $R_{t+1}\text{ uses }\rho_t,$; $R_{t+2}\text{ uses }\rho_{t:t+1},$; $R_{t+3}\text{ uses }\rho_{t:t+2},$ etc. So what exactly should the single denominator be?

There isn't one obvious normalization that preserves the desired asymptotics. The book notes that proposed per-decision weighted variants known there were not consistent. This distinction is worth putting in your tracker:

$$
\boxed{
\begin{array}{ll}
\text{Ordinary IS} &
\text{full ratio, unbiased, high variance}[1mm]
\text{Weighted IS} &
\text{full ratio + self-normalization, biased finite-sample}[1mm]
\text{Per-decision IS} &
\text{truncate ratios reward-by-reward, unbiased}\\
\end{array}
}
$$

and then §7.4 introduces yet another tool:

$$
\boxed{\text{control variates}}
$$

to reduce variance further without changing the expectation.

That is the progression worth remembering. The exact §5.8 estimators are not.
