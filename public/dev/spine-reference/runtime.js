// Read poses from the project's actual Spine runtime. No motion is authored here.
export async function loadRig(url) {
  const resource = await PIXI.Assets.load(new URL('../../'+url.replace(/^\//,''),import.meta.url).href);
  const sp = new PIXI.spine.Spine(resource.spineData);
  sp.autoUpdate = false;
  sp.skeleton.setToSetupPose();
  sp.update(0);
  return sp;
}

export function poseRig(sp, animation = null, time = 0) {
  sp.skeleton.setToSetupPose();
  sp.state.clearTracks();
  if (animation) {
    const clip = sp.spineData.findAnimation(animation);
    if (!clip) throw new Error(`Unknown animation: ${animation}`);
    sp.state.setAnimation(0, animation, false);
    sp.update(Math.max(0, Math.min(time, clip.duration)));
  } else sp.update(0);
}

const number = v => Number.isFinite(v) ? v : null;
export function attachmentGeometry(slot) {
  const attachment = slot.getAttachment();
  if (!attachment) return null;
  let vertices = [];
  try {
    if (attachment.worldVerticesLength) {
      const buffer = new Float32Array(attachment.worldVerticesLength);
      attachment.computeWorldVertices(slot, 0, buffer.length, buffer, 0, 2);
      vertices = Array.from(buffer);
    } else if (attachment.offset && attachment.computeWorldVertices) {
      // pixi-spine renders regions as sprites and leaves the Spine offset cache
      // uninitialized. Populate it using the runtime's own region geometry.
      attachment.updateOffset?.();
      attachment.setRegion?.(attachment.region);
      const buffer = new Float32Array(8);
      attachment.computeWorldVertices(slot.bone, buffer, 0, 2);
      vertices = Array.from(buffer);
    }
  } catch (e) {
    return { name: attachment.name, type: attachment.type, error: e.message };
  }
  const points = [];
  for (let i = 0; i < vertices.length; i += 2) points.push([vertices[i], -vertices[i + 1]]);
  const region = attachment.region;
  return {
    name: attachment.name, type: attachment.type,
    weighted: Boolean(attachment.bones?.length),
    points, triangles: Array.from(attachment.triangles || []),
    uvs: Array.from(attachment.regionUVs || attachment.uvs || []),
    atlasRegion: region ? { name: region.name, width: region.width, height: region.height, originalWidth: region.originalWidth, originalHeight: region.originalHeight, offsetX: region.offsetX, offsetY: region.offsetY, rotate: region.rotate } : null,
  };
}

export function readRig(sp) {
  const skeleton = sp.skeleton;
  const order = new Map(skeleton.drawOrder.map((slot, i) => [slot.data.name, i]));
  return {
    coordinateSystem: { x: 'right', y: 'up', units: 'source-rig-units', cameraExcluded: true },
    bones: skeleton.bones.map(bone => ({
      id: bone.data.name, parent: bone.parent?.data.name || null,
      length: number(bone.data.length),
      setup: { x: bone.data.x, y: bone.data.y, rotation: bone.data.rotation, scaleX: bone.data.scaleX, scaleY: bone.data.scaleY },
      world: [number(bone.matrix.tx), number(-bone.matrix.ty)],
      matrix: [bone.matrix.a, -bone.matrix.b, bone.matrix.c, -bone.matrix.d, bone.matrix.tx, -bone.matrix.ty],
    })),
    slots: skeleton.slots.map(slot => ({
      id: slot.data.name, bone: slot.bone.data.name, drawOrder: order.get(slot.data.name),
      alpha: number(slot.color.a * slot.bone.skeleton.color.a * (slot.getAttachment()?.color?.a ?? 1)),
      attachment: attachmentGeometry(slot),
    })),
    animations: sp.spineData.animations.map(a => ({ id: a.name, duration: a.duration })),
  };
}
