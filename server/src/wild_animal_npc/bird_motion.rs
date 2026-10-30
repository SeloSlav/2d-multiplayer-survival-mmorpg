use super::alk_wildlife::WildlifeExclusionZone;

/// Stop exactly at a goal even when one AI step is longer than the remainder.
pub fn flight_step(from:(f32,f32),to:(f32,f32),speed:f32,dt:f32)->(f32,f32) {
    let (dx,dy)=(to.0-from.0,to.1-from.1);let distance=dx.hypot(dy);
    if distance<=0.001{return to;}
    let fraction=(speed.max(0.0)*dt.max(0.0)/distance).min(1.0);
    (from.0+dx*fraction,from.1+dy*fraction)
}

pub fn event_probability(rate_per_second:f32,dt:f32)->f32 {
    1.0-(-rate_per_second.max(0.0)*dt.max(0.0)).exp()
}

/// Choose one reachable leg and keep it until arrival. Whole segments avoid
/// compounds, and clamping may never produce a destination at our own feet.
pub fn flight_goal(from:(f32,f32),heading:f32,distance:f32,zones:&[WildlifeExclusionZone],world:(f32,f32))->Option<(f32,f32)> {
    for turn in [0.0,0.35,-0.35,0.7,-0.7,1.2,-1.2,1.8,-1.8,std::f32::consts::PI] {
        let angle=heading+turn;
        let goal=((from.0+angle.cos()*distance).clamp(50.0,world.0-50.0),(from.1+angle.sin()*distance).clamp(50.0,world.1-50.0));
        if (goal.0-from.0).hypot(goal.1-from.1)>=80.0 && zones.iter().all(|z|!z.blocks_movement(from,goal)) {return Some(goal);}
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn close_flight_goals_never_oscillate_or_overshoot() {
        for speed in [450.0,504.0,700.0] {for dt in [0.016,0.1,0.25] {for remainder in [10.1,20.1,35.0,49.0,151.0] {
            let goal=(400.0+remainder,300.0);let mut p=(400.0,300.0);
            for _ in 0..100 {let next=flight_step(p,goal,speed,dt);assert!(next.0>=p.0&&next.0<=goal.0);p=next;}
            assert_eq!(p,goal);
        }}}
    }
    #[test]
    fn edge_and_compound_escape_goals_are_reachable_without_repeated_reversals() {
        let world=(10000.0,10000.0);let zones=[WildlifeExclusionZone::new(5000.0,5000.0,600.0)];
        for (from,heading) in [((51.0,51.0),-2.3),((6090.0,5000.0),std::f32::consts::PI),((9949.0,5000.0),0.0)] {
            let goal=flight_goal(from,heading,600.0,&zones,world).unwrap();
            assert!((goal.0-from.0).hypot(goal.1-from.1)>=80.0);
            assert!(zones.iter().all(|z|!z.blocks_movement(from,goal)));
            let mut p=from;for _ in 0..120 {p=flight_step(p,goal,504.0,0.1);}assert_eq!(p,goal);
        }
    }
    #[test]
    fn landing_probability_uses_elapsed_time() {
        for fps in [10,30,60] {let p=event_probability(0.18,1.0/fps as f32);assert!(((1.0-p).powi(fps)-(-0.18_f32).exp()).abs()<0.00001);}
    }
}
