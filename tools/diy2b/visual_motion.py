"""Explicit screen-space choreography; no per-frame label/semantic corrections.

Feet, hands and blade direction have separate authored tracks. Bake IK only
after those tracks are interpolated, so contact remains fixed between keys.
The original rig/attachments come from a recoverable Git commit, unmodified.
"""
import argparse, copy, json, math, pathlib, subprocess

p=argparse.ArgumentParser()
p.add_argument('--repo',required=True); p.add_argument('--out',required=True)
p.add_argument('--artifacts',required=True); p.add_argument('--seed',default='ae4c9bd')
args=p.parse_args(); root=pathlib.Path(args.out); receipt=[]
rad=math.radians; deg=math.degrees
def wrap(a): return (a+180)%360-180
def rotate(v,a):
    c,s=math.cos(rad(a)),math.sin(rad(a)); return (v[0]*c-v[1]*s,v[0]*s+v[1]*c)
def add(a,b): return (a[0]+b[0],a[1]+b[1])
def sub(a,b): return (a[0]-b[0],a[1]-b[1])
def angle(v): return deg(math.atan2(v[1],v[0]))
def interp(keys,t):
    if t<=keys[0][0]: return keys[0][1:]
    for a,b in zip(keys,keys[1:]):
        if t<=b[0]:
            f=(t-a[0])/(b[0]-a[0]); f=f*f*(3-2*f)
            return tuple(x+(y-x)*f for x,y in zip(a[1:],b[1:]))
    return keys[-1][1:]

# time, pelvis x/y, torso, sword-hilt x/y, blade angle, two-hand blend
# Hilt coordinates and translations use the front rig's world units.
attack=[(0,0,0,0,-67,129,-29,0),(.18,-3,-5,5,-67,139,-27,0),
        (.29,2,-9,-6,-20,144,-30,1),(.42,7,-10,-12,36,168,28,1),
        (.49,5,-6,-5,3,226,90,1),(.59,1,-4,4,-20,250,110,1),
        (.70,9,-12,-14,48,179,-22,1),(.78,7,-10,-10,45,155,-35,1),
        (.95,1,-3,-3,-38,139,-24,0),(1.15,0,0,0,-67,129,-29,0)]
skill=[(0,0,0,0,-67,129,-29,0),(.16,-3,-9,7,-52,151,120,1),
       (.28,7,-12,-13,45,179,-20,1),(.37,3,-7,-4,-16,154,-36,1),
       (.52,8,-10,-12,40,184,38,1),(.65,1,-7,5,-24,255,110,1),
       (.84,10,-15,-16,50,186,-24,1),(.96,7,-11,-10,45,157,-35,1),
       (1.16,1,-3,-2,-35,139,-26,0),(1.32,0,0,0,-67,129,-29,0)]

for side,name in [('front','char_diy_2b'),('back','char_diy_2b_back')]:
    rel=f'public/dev/diy-2b/model/{side}/{name}.json'
    sk=json.loads(subprocess.check_output(['git','-C',args.repo,'show',args.seed+':'+rel]))
    bones={b['name']:b for b in sk['bones']}; setup={}
    for b in sk['bones']:
        parent=setup.get(b.get('parent'),(0,0,0)); xy=add(parent[:2],rotate((b.get('x',0),b.get('y',0)),parent[2]))
        setup[b['name']]=(*xy,parent[2]+b.get('rotation',0))
    # Clear the dense retargeting stack; retain the small original clips for
    # unaffected actions and preserve all Pod/event/slot contracts.
    for n in list(sk['animations']):
        if n.endswith('_v1'): sk['animations'][n[:-3]]=copy.deepcopy(sk['animations'][n])
    q=setup['hip'][1]/174.94
    sword_beta=angle((bones['sword_tip']['x'],bones['sword_tip']['y']))
    rest_blade=setup['sword'][2]+sword_beta
    rest_hilt=setup['sword'][:2]
    endeffector_receipt={}
    def fk(pose):
        w={}
        for b in sk['bones']:
            parent=w.get(b.get('parent'),(0,0,0)); data=pose.get(b['name'],{})
            xy=add(parent[:2],rotate((b.get('x',0)+data.get('x',0),b.get('y',0)+data.get('y',0)),parent[2]))
            w[b['name']]=(*xy,parent[2]+b.get('rotation',0)+data.get('angle',0))
        return w
    def solve_chain(pose,upper,lower,end,target,branch=1):
        w=fk(pose); start=w[upper][:2]
        v1=(bones[lower]['x'],bones[lower]['y']); v2=(bones[end]['x'],bones[end]['y'])
        l1,l2=math.hypot(*v1),math.hypot(*v2); v=sub(target,start)
        minimum=math.sqrt(l1*l1+l2*l2-2*l1*l2*math.cos(rad(45))) if upper.startswith('upperarm') else abs(l1-l2)+.0001
        d=max(minimum,min(l1+l2-.0001,math.hypot(*v)))
        a=angle(v); delta=deg(math.acos(max(-1,min(1,(l1*l1+d*d-l2*l2)/(2*l1*d)))))
        u=a+branch*delta; elbow=add(start,rotate((l1,0),u)); reached=add(start,rotate((d,0),a))
        f=angle(sub(reached,elbow)); parent=w.get(bones[upper].get('parent'),(0,0,0))[2]
        ur=wrap(u-angle(v1)-parent-bones[upper].get('rotation',0))
        pose[upper]={'angle':ur}; pose[lower]={'angle':wrap(f-angle(v2)-(parent+bones[upper].get('rotation',0)+ur)-bones[lower].get('rotation',0))}
        return f
    def authored(values,kneel=False,collapse=None):
        hx,hy,tor,gx,gy,blade,both=values
        pose={'hip':{'x':hx*q,'y':hy*q},'torso':{'angle':tor},'head':{'angle':-tor*.45},
              'skirt':{'angle':-tor*.22}}
        if collapse is not None: pose['head']={'angle':11.25+(-10-11.25)*collapse}
        if kneel:
            # Both shins folded back on the ground, rather than a forward lunge.
            pose['hip']={'x':-8*q,'y':(85*q)-setup['hip'][1]}
            pose['head']={'angle':-10}
            for s in 'rl':
                base1=angle((bones['shin_'+s]['x'],bones['shin_'+s]['y']))
                base2=angle((bones['foot_'+s]['x'],bones['foot_'+s]['y']))
                hip_y=85*q+bones['thigh_'+s]['y']
                length=math.hypot(bones['shin_'+s]['x'],bones['shin_'+s]['y'])
                thigh=deg(math.asin((30-hip_y)/length))
                pose['thigh_'+s]={'angle':thigh-base1}
                pose['shin_'+s]={'angle':-180-base2-pose['thigh_'+s]['angle']}
                pose['foot_'+s]={'angle':-pose['thigh_'+s]['angle']-pose['shin_'+s]['angle']}
        else:
            for s in 'rl':
                target=setup['foot_'+s][:2]
                if collapse is not None: target=tuple(a+(b-a)*collapse for a,b in zip(target,kneeling_contacts[s]))
                solve_chain(pose,'thigh_'+s,'shin_'+s,'foot_'+s,target)
                w=fk(pose); pose['foot_'+s]={'angle':-w['shin_'+s][2]}
        # Return exactly to this view's original hilt. The active gesture is
        # shared across views; transition is authored, not relabelled per frame.
        active=min(1,both+.001)
        reference=((-67*q,129*q))
        target=add(rest_hilt,sub((gx*q,gy*q),reference))
        if side=='back':
            active=min(1,max(both,(abs(gx+67)+abs(gy-129))/90))
            target=(rest_hilt[0]*(1-active)+(gx+22)*q*active,rest_hilt[1]*(1-active)+gy*q*active)
        blade=-7 if kneel else rest_blade+(blade+29)
        # Keep the wrist and blade coupled; blade projection/shrinking is gone.
        hand_a=blade-sword_beta-bones['sword'].get('rotation',0)
        wrist=sub(target,rotate((bones['sword']['x'],bones['sword']['y']),hand_a))
        solve_chain(pose,'upperarm_r','forearm_r','hand_r',wrist,branch=1 if side=='front' else -1)
        w=fk(pose); pose['hand_r']={'angle':wrap(hand_a-w['forearm_r'][2])}
        pose['sword']={'angle':0}
        w=fk(pose)
        support=sub(w['hand_r'][:2],rotate((10*q,0),hand_a))
        left_rest=setup['hand_l'][:2]
        left=(left_rest[0]*(1-both)+support[0]*both,left_rest[1]*(1-both)+support[1]*both)
        if kneel: left=(65*q,42*q)
        elif collapse is not None: left=tuple(a+(b-a)*collapse for a,b in zip(left_rest,(65*q,42*q)))
        solve_chain(pose,'upperarm_l','forearm_l','hand_l',left,branch=1)
        w=fk(pose); pose['hand_l']={'angle':wrap(hand_a-w['forearm_l'][2]) if both>.1 else -w['forearm_l'][2]}
        # Small secondary response, driven by the same explicit torso track.
        for s in ['a','b']:
            for suffix,gain in [('',.08),('2',.10),('3',.14)]:
                if 'hair_'+s+suffix in bones: pose['hair_'+s+suffix]={'angle':-tor*gain}
        return pose
    def bake(name,keys,kneel=False,collapse=False):
        duration=keys[-1][0]; frames=[]; tracks={}; previous={}
        for i in range(math.ceil(duration*120)+1):
            t=min(duration,i/120); vals=interp(keys,t)
            blend=interp([(0,0),(.12,0),(.6,1),(1.2,1)],t)[0] if collapse else None
            pose=authored(vals,kneel,blend)
            for bone,channels in pose.items():
                dest=tracks.setdefault(bone,{})
                if 'angle' in channels:
                    v=channels['angle']; v=previous.get(bone,v)+wrap(v-previous.get(bone,v)); previous[bone]=v
                    dest.setdefault('rotate',[]).append({'time':round(t,6),'angle':round(v,5)})
                if 'x' in channels: dest.setdefault('translate',[]).append({'time':round(t,6),'x':round(channels['x'],5),'y':round(channels['y'],5)})
            w=fk(pose)
            if i%6==0: frames.append({'t':round(t,4), **{n:list(w[n][:2]) for n in ['hip','head','sword','sword_tip','thigh_r','shin_r','foot_r','thigh_l','shin_l','foot_l','upperarm_r','forearm_r','hand_r','upperarm_l','forearm_l','hand_l']}})
        old=sk['animations'].get(name,{})
        clip={'bones':tracks}
        if old.get('events'): clip['events']=old['events']
        # Avoid inherited hand/draw-order switches hiding the blade mid-swing.
        if not name.startswith('Attack') and name!='Skill_1' and old.get('slots'): clip['slots']=copy.deepcopy(old['slots'])
        if name in ('Attack','Skill_1') and 'hand_l_grip' in sk['skins'][0]['attachments'].get('hand_l',{}):
            clip['slots']={'hand_l':{'attachment':[{'time':0,'name':'hand_l'},{'time':.24 if name=='Attack' else .1,'name':'hand_l_grip'},{'time':.96 if name=='Attack' else 1.12,'name':'hand_l'}]}}
        if side=='front':
            order=[s['name'] for s in sk['slots']]; group=['forearm_l','upperarm_l','hand_l','forearm_r','upperarm_r','sword','hand_r']
            rest=[s for s in order if s not in group]; wanted=rest+group
            clip['drawOrder']=[{'time':0,'offsets':[{'slot':s,'offset':wanted.index(s)-order.index(s)} for s in order if wanted.index(s)!=order.index(s)]}]
        sk['animations'][name]=clip; endeffector_receipt[name]=frames
    bake('Attack',attack)
    sk['animations']['Attack']['events']=[{'time':.42,'name':'OnAttack'},{'time':.7,'name':'OnAttack'}]
    bake('Skill_1',skill)
    sk['animations']['Skill_1']['events']=[{'time':.28,'name':'OnAttack'},{'time':.52,'name':'OnAttack'},{'time':.84,'name':'OnAttack'}]
    kneel=[(0,0,0,-38,20,47,-7,0),(.62,0,0,-33,20,49,-7,0),(.86,0,0,-29,20,54,-7,0),(1.12,0,0,-36,20,49,-7,0),(1.7,0,0,-38,20,47,-7,0)]
    bake('Stun_Skill_3',kneel,True)
    sk['animations']['Stun_Skill_3']['events']=[{'time':.86,'name':'OnJolt'}]
    sk.setdefault('events',{}).setdefault('OnJolt',{})
    # The hilt/blade remain controlled through the collapse; independently
    # interpolating old local joint angles sent the long blade below the floor.
    charged=(0,-20,-25,-20,109,-15,0)
    final=(-8,85-174.94,-38,20,47,-7-rest_blade-29,0)
    bake('Skill_3_Begin',[(0,0,0,0,-67,129,-29,0),(.7,0,-15,-20,-40,122,-15,0),(1,*charged)])
    knee_world=fk(authored(kneel[0][1:],True))
    kneeling_contacts={s:knee_world['foot_'+s][:2] for s in 'rl'}
    bake('Skill_3_End',[(0,*charged),(.12,*charged),(.6,*final),(1.2,*final)],collapse=True)
    sk['diyMotionSource']='explicit-choreography'
    target=root/rel; target.write_text(json.dumps(sk,separators=(',',':')),encoding='utf-8')
    receipt.append({'side':side,'model':str(target),'joints':endeffector_receipt})
out=pathlib.Path(args.artifacts); out.mkdir(parents=True,exist_ok=True)
(out/'authored-joints.json').write_text(json.dumps(receipt,indent=2),encoding='utf-8')
print(json.dumps({'models':[r['model'] for r in receipt],'joints':str(out/'authored-joints.json')}))
