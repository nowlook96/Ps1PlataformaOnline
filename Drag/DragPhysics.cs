namespace PlataformaOnline.Drag;

/// <summary>
/// Espelho exato de wwwroot/arrancada/js/physics.js (mesma ordem de operações em double),
/// para o servidor reexecutar a corrida a partir das entradas gravadas e calcular o resultado oficial.
/// Ao mudar a física, mude os dois arquivos juntos.
/// </summary>
public static class DragPhysics
{
    private const double G = 9.81;
    private const double Rho = 1.225;
    private const double RpmPerRads = 9.549296585513721;
    private const double RotMass = 1.04;
    private const double ClutchS = 2.0;
    private const double ClutchDrop = 900;
    private const double SpinLoss = 0.4;
    private const double PerfectRpm = 250;
    private const double ShiftRpmFollow = 0.06;

    public const int EvThrottleOff = 0, EvThrottleOn = 1, EvShift = 2;

    public sealed class RunState
    {
        public double X, V, Rpm, ShiftT, LaunchRpm, ClutchT, Spin, FinishTime, TopSpeed;
        public int Gear, LaunchStep = -1, Shifts, Perfect;
        public bool Launched, Jump, Limiter, Finished;
    }

    public sealed record BotPlan(double LaunchRpm, int ReactionSteps, double[] ShiftRpm);

    public static CarPhysics DeriveCar(CarPhysics physics, IEnumerable<PartDef> parts)
    {
        var c = physics.Clone();
        foreach (var part in parts)
        {
            var e = part.Effects;
            if (e.TorqueMult is { } tm) c.Torque = c.Torque.Select(p => new[] { p[0], p[1] * tm }).ToArray();
            if (e.MassKg is { } mk) c.MassKg += mk;
            if (e.GripMult is { } gm) c.Grip *= gm;
            if (e.ShiftTimeMult is { } sm) c.ShiftTimeS *= sm;
            if (e.CdAMult is { } cm) c.CdA *= cm;
        }
        return c;
    }

    public static double TorqueAt(CarPhysics c, double rpm)
    {
        var t = c.Torque;
        if (rpm <= t[0][0]) return t[0][1];
        for (var i = 1; i < t.Length; i++)
        {
            if (rpm <= t[i][0])
            {
                var k = (rpm - t[i - 1][0]) / (t[i][0] - t[i - 1][0]);
                return t[i - 1][1] + (t[i][1] - t[i - 1][1]) * k;
            }
        }
        return t[^1][1];
    }

    public static RunState NewRunState(CarPhysics c) => new() { Rpm = c.IdleRpm };

    public static void Step(RunState s, CarPhysics c, bool throttle, bool shift, int k, int greenStep, int hz, double distance)
    {
        var dt = 1.0 / hz;

        if (shift)
        {
            if (s.Gear == 0)
            {
                if (!s.Launched)
                {
                    s.Launched = true;
                    s.Gear = 1;
                    s.LaunchStep = k;
                    s.Jump = k < greenStep;
                    s.LaunchRpm = s.Rpm;
                    s.ClutchT = 0;
                }
            }
            else if (s.Gear < c.Gears.Length && s.ShiftT <= 0)
            {
                var diff = s.Rpm - c.ShiftRpm;
                var perfect = diff >= -PerfectRpm && diff <= PerfectRpm;
                s.Gear += 1;
                s.Shifts += 1;
                if (perfect) s.Perfect += 1;
                s.ShiftT = perfect ? c.ShiftTimeS * 0.5 : c.ShiftTimeS;
            }
        }

        double force = 0;
        s.Limiter = false;

        if (s.Gear == 0)
        {
            s.Rpm += throttle ? 9000 * dt : -5000 * dt;
            if (s.Rpm >= c.LimiterRpm) { s.Rpm = c.LimiterRpm - 350; s.Limiter = true; }
            if (s.Rpm < c.IdleRpm) s.Rpm = c.IdleRpm;
            s.Spin = 0;
        }
        else
        {
            var ratio = c.Gears[s.Gear - 1] * c.FinalDrive;
            var coupled = s.V / c.TireRadiusM * RpmPerRads * ratio;
            if (s.ShiftT > 0)
            {
                s.ShiftT -= dt;
                s.Rpm += (coupled - s.Rpm) * ShiftRpmFollow;
                s.Spin = 0;
            }
            else
            {
                double rpm;
                if (s.ClutchT < ClutchS)
                {
                    s.ClutchT += dt;
                    var slip = s.LaunchRpm - ClutchDrop * (s.ClutchT / ClutchS);
                    if (coupled >= slip) s.ClutchT = ClutchS;
                    rpm = Math.Max(coupled, slip);
                }
                else
                {
                    rpm = coupled * (1 + 0.25 * s.Spin);
                }
                if (rpm < c.IdleRpm) rpm = c.IdleRpm;
                if (rpm >= c.LimiterRpm) { rpm = c.LimiterRpm; s.Limiter = true; }
                s.Rpm = rpm;

                if (throttle && !s.Limiter)
                {
                    var wheelF = TorqueAt(c, rpm) * ratio * c.Efficiency / c.TireRadiusM;
                    var maxF = c.Grip * c.MassKg * G * c.DriveWeight;
                    if (wheelF > maxF)
                    {
                        s.Spin = Math.Min(1, (wheelF - maxF) / maxF);
                        force = maxF * (1 - SpinLoss * s.Spin);
                    }
                    else
                    {
                        s.Spin = 0;
                        force = wheelF;
                    }
                }
                else
                {
                    s.Spin = 0;
                    force = throttle ? 0 : -ratio * 25;
                }
            }
        }

        var drag = 0.5 * Rho * c.CdA * s.V * s.V;
        var roll = s.V > 0 ? c.Crr * c.MassKg * G : 0;
        var a = (force - drag - roll) / (c.MassKg * RotMass);
        s.V += a * dt;
        if (s.V < 0) s.V = 0;
        var prevX = s.X;
        s.X += s.V * dt;
        if (s.V > s.TopSpeed) s.TopSpeed = s.V;
        if (!s.Finished && s.X >= distance)
        {
            s.Finished = true;
            var frac = (distance - prevX) / (s.X - prevX);
            s.FinishTime = (k + frac) * dt;
        }
    }

    public static (bool Throttle, bool Shift) BotInput(RunState s, CarPhysics c, BotPlan plan, int k, int greenStep)
    {
        if (s.Gear == 0)
            return (s.Rpm < plan.LaunchRpm, k >= greenStep + plan.ReactionSteps);
        var target = s.Gear - 1 < plan.ShiftRpm.Length ? plan.ShiftRpm[s.Gear - 1] : c.LimiterRpm;
        return (true, s.Gear < c.Gears.Length && s.ShiftT <= 0 && s.Rpm >= target);
    }

    public static RunState SimulateBot(CarPhysics c, BotPlan plan, int greenStep, int hz, double distance, int maxSteps)
    {
        var s = NewRunState(c);
        for (var k = 0; k < maxSteps && !s.Finished; k++)
        {
            var (throttle, shift) = BotInput(s, c, plan, k, greenStep);
            Step(s, c, throttle, shift, k, greenStep, hz, distance);
        }
        return s;
    }

    /// <summary>
    /// Reexecuta a corrida do jogador a partir dos eventos [passo, código] (já validados: ordenados e dentro do limite).
    /// </summary>
    public static RunState Replay(CarPhysics c, IReadOnlyList<int[]> events, int greenStep, int hz, double distance, int maxSteps)
    {
        var s = NewRunState(c);
        var throttle = false;
        var e = 0;
        for (var k = 0; k < maxSteps && !s.Finished; k++)
        {
            var shift = false;
            while (e < events.Count && events[e][0] == k)
            {
                switch (events[e][1])
                {
                    case EvThrottleOff: throttle = false; break;
                    case EvThrottleOn: throttle = true; break;
                    case EvShift: shift = true; break;
                }
                e++;
            }
            Step(s, c, throttle, shift, k, greenStep, hz, distance);
        }
        return s;
    }
}
