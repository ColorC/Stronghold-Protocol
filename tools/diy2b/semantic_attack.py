"""A small single-hand attack study: reference bend, planted feet, rigid grip.

The original model and all other clips stay intact. Controls are authored in
joint-local coordinates, preserving each view's own setup winding. A hand is
not solved independently of its grip/blade. This does not certify anatomy or
artistic quality; inspect the resulting native-runtime images.
"""
import argparse
import copy
import json
import math
import pathlib
import subprocess

def sample(keys, t):
    if t <= keys[0][0]: return keys[0][1]
    for a, b in zip(keys, keys[1:]):
        if t <= b[0]:
            u = (t-a[0])/(b[0]-a[0]); u = u*u*(3-2*u)
            return a[1]+(b[1]-a[1])*u
    return keys[-1][1]

DURATION = 1.15
UPPER = [(0,0),(.13,12),(.24,72),(.30,80),(.36,60),(.42,20),(.52,9),(.60,75),(.70,16),(.80,12),(.98,6),(DURATION,0)]
FLEX = [(0,0),(.16,25),(.24,90),(.28,115),(.33,108),(.42,2),(.52,0),(.59,110),(.63,92),(.70,4),(.80,0),(.98,0),(DURATION,0)]
WRIST = [(0,0),(.24,2),(.33,3),(.42,8),(.52,5),(.59,2),(.70,8),(.80,4),(.98,0),(DURATION,0)]
TORSO = [(0,0),(.16,4),(.26,6),(.34,1),(.42,-8),(.50,-6),(.59,3),(.70,-10),(.80,-5),(DURATION,0)]
HIP_X = [(0,0),(.16,-2),(.28,-3),(.36,2),(.43,7),(.52,4),(.60,-1),(.71,8),(.80,5),(DURATION,0)]
HIP_Y = [(0,0),(.14,-3),(.28,-5),(.43,-7),(.52,-5),(.59,-3),(.71,-8),(.83,-4),(DURATION,0)]
SUPPORT = [(0,0),(.22,-8),(.31,-6),(.46,12),(.56,4),(.63,-6),(.75,10),(.88,4),(DURATION,0)]

def build(model, side):
    sk = copy.deepcopy(model); bones = {b['name']: b for b in sk['bones']}
    def rotate(v,a):
        c,s=math.cos(math.radians(a)),math.sin(math.radians(a));return (v[0]*c-v[1]*s,v[0]*s+v[1]*c)
    def fk(pose):
        w={}
        for b in sk['bones']:
            p=w.get(b.get('parent'),(0,0,0));v=pose.get(b['name'],{})
            q=rotate((b.get('x',0)+v.get('x',0),b.get('y',0)+v.get('y',0)),p[2])
            w[b['name']]=(p[0]+q[0],p[1]+q[1],p[2]+b.get('rotation',0)+v.get('angle',0))
        return w
    rest=fk({})
    def turn(a,b,c):
        u=(b[0]-a[0],b[1]-a[1]);v=(c[0]-b[0],c[1]-b[1])
        return math.degrees(math.atan2(u[0]*v[1]-u[1]*v[0],u[0]*v[0]+u[1]*v[1]))
    def winding(upper,lower,end):
        theta=turn(rest[upper],rest[lower],rest[end])
        if abs(theta)<.1: raise ValueError(f'{side} {lower}: reference winding needs explicit calibration')
        return 1 if theta>0 else -1
    arm_sign={s:winding('upperarm_'+s,'forearm_'+s,'hand_'+s) for s in 'rl'}
    leg_sign={s:winding('thigh_'+s,'shin_'+s,'foot_'+s) for s in 'rl'}
    for name in ['hip','torso']+[p+'_'+s for s in 'rl' for p in ['upperarm','forearm','hand','thigh','shin','foot']]:
        b=bones[name]
        if b.get('scaleX',1)!=1 or b.get('scaleY',1)!=1 or b.get('shearX',0) or b.get('shearY',0):
            raise ValueError('This study requires the calibrated unit-scale 2B chain: '+name)
    q=rest['hip'][1]/174.94
    def primary_controls(t):
        upper,flex=sample(UPPER,t),sample(FLEX,t)
        # This back-view artwork is not a planar mirror: its hand, elbow and
        # shorter blade have their own offsets. Calibrate the preparation so
        # the sword stays beside the large head instead of disappearing in it.
        if side=='back':upper=upper if upper<=20 else 20+(upper-20)*.2;flex*=.52
        return upper,flex
    def planted(pose,s):
        upper,lower,end='thigh_'+s,'shin_'+s,'foot_'+s
        w=fk(pose);start=w[upper];target=rest[end]
        v1=(bones[lower]['x'],bones[lower]['y']);v2=(bones[end]['x'],bones[end]['y'])
        l1,l2=math.hypot(*v1),math.hypot(*v2);v=(target[0]-start[0],target[1]-start[1]);d=math.hypot(*v)
        if not abs(l1-l2)+1e-6<d<l1+l2-1e-6: raise ValueError(f'{side} planted foot {s} is unreachable: {d}')
        heading=math.degrees(math.atan2(v[1],v[0]));delta=math.degrees(math.acos(max(-1,min(1,(l1*l1+d*d-l2*l2)/(2*l1*d)))))
        # The upper segment lies on the opposite side of the target ray from
        # the cross-product winding; do not confuse this with Spine Positive.
        u=heading-leg_sign[s]*delta;offset=rotate((l1,0),u);elbow=(start[0]+offset[0],start[1]+offset[1])
        f=math.degrees(math.atan2(target[1]-elbow[1],target[0]-elbow[0]));parent=w[bones[upper]['parent']][2]
        ur=u-math.degrees(math.atan2(v1[1],v1[0]))-parent-bones[upper].get('rotation',0)
        pose[upper]={'angle':ur}
        pose[lower]={'angle':f-math.degrees(math.atan2(v2[1],v2[0]))-(parent+bones[upper].get('rotation',0)+ur)-bones[lower].get('rotation',0)}
        pose[end]={'angle':rest[end][2]-fk(pose)[lower][2]-bones[end].get('rotation',0)}
    tracks={};frames=[]
    for i in range(139):
        t=min(DURATION,i/120);tor=sample(TORSO,t);upper,flex=primary_controls(t)
        pose={'hip':{'x':sample(HIP_X,t)*q,'y':sample(HIP_Y,t)*q},'torso':{'angle':tor},
              'head':{'angle':-tor*.4},'upperarm_r':{'angle':upper},
              'forearm_r':{'angle':arm_sign['r']*flex},'hand_r':{'angle':sample(WRIST,t)},'sword':{'angle':0},
              'upperarm_l':{'angle':sample(SUPPORT,t)},
              'forearm_l':{'angle':arm_sign['l']*min(5,flex*.05)},'hand_l':{'angle':0}}
        for s in 'rl':planted(pose,s)
        tail=1-sample([(.92,0),(DURATION,1)],t)
        pose['skirt']={'angle':-sample(TORSO,max(0,t-.04))*.18*tail}
        for suffix in ['a','b']:
            for extension,gain,lag in [('',.08,.045),('2',.10,.065),('3',.12,.085)]:
                name='hair_'+suffix+extension
                if name in bones:pose[name]={'angle':-sample(TORSO,max(0,t-lag))*gain*tail}
        for bone,channels in pose.items():
            dest=tracks.setdefault(bone,{})
            if 'angle' in channels:dest.setdefault('rotate',[]).append({'time':round(t,6),'angle':round(channels['angle'],6)})
            if 'x' in channels:dest.setdefault('translate',[]).append({'time':round(t,6),'x':round(channels['x'],6),'y':round(channels['y'],6)})
        w=fk(pose)
        frames.append({'time':t,'points':{n:list(w[n][:2]) for n in ['hip','head','upperarm_r','forearm_r','hand_r','upperarm_l','forearm_l','hand_l','sword','sword_tip','thigh_r','shin_r','foot_r','thigh_l','shin_l','foot_l']},'controls':{'torso':tor,'primaryUpper':upper,'primaryFlexIncrement':flex,'wristLocalDelta':sample(WRIST,t)}})
    old=model['animations']['Attack'];modified=set(tracks)
    for bone,channels in old.get('bones',{}).items():
        if bone not in modified:tracks[bone]=copy.deepcopy(channels)
    # Setup draw order keeps the head in front of the sword during preparation.
    # Open secondary hand stays in the original attachment throughout.
    sk['animations']['Attack']={'bones':tracks,'events':copy.deepcopy(old.get('events',[]))}
    if any(sk[k]!=model[k] for k in model if k!='animations'):raise AssertionError('Rig or art changed')
    if any(v!=sk['animations'][k] for k,v in model['animations'].items() if k!='Attack'):raise AssertionError('Other clip changed')
    return sk,{'side':side,'armWinding':arm_sign,'legWinding':leg_sign,'duration':DURATION,'frames':frames,'unchangedOtherClips':len(model['animations'])-1}

def main():
    p=argparse.ArgumentParser();p.add_argument('--repo',required=True);p.add_argument('--out',required=True);p.add_argument('--artifacts',required=True);p.add_argument('--seed',default='67bb26c2d3d6b9e5db12282a147759a3a7b84867');args=p.parse_args()
    outputs=[]
    for side,name in [('front','char_diy_2b'),('back','char_diy_2b_back')]:
        rel=f'public/dev/diy-2b/model/{side}/{name}.json'
        original=json.loads(subprocess.check_output(['git','-C',args.repo,'show',args.seed+':'+rel]))
        candidate,report=build(original,side);file=pathlib.Path(args.out)/rel;file.parent.mkdir(parents=True,exist_ok=True);file.write_text(json.dumps(candidate,separators=(',',':')),encoding='utf-8');report['model']=str(file.resolve());outputs.append(report)
    artifact=pathlib.Path(args.artifacts);artifact.mkdir(parents=True,exist_ok=True);file=artifact/'authored-attack.json';file.write_text(json.dumps({'sourceCommit':args.seed,'outputs':outputs},indent=2),encoding='utf-8');print(json.dumps({'models':[x['model'] for x in outputs],'evidence':str(file.resolve())}))

if __name__=='__main__':main()
