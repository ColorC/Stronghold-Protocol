// ArkVfxRecorder — isolated batch exporter for official effect prefabs.
// Loads official Arknights effect bundles (re-saved uncompressed), instantiates one effect prefab in a preview scene
// swaps Android shaders for source-derived HLSL ports and records premultiplied colour and coverage.
// Run only in the exporter's own temporary Unity project; inputs remain at their explicit absolute paths.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.SceneManagement;

public static class ArkVfxRecorder
{
    static readonly List<AssetBundle> s_bundles = new List<AssetBundle>();

    [Serializable]
    public class Job
    {
        public string prefab;
        public string outDir;
        public float fps = 30f;
        public float seconds = 2f;
        public int width = 640;
        public int height = 480;
        public float pitch = 30f;      // camera looks down by this many degrees
        public float padding = 1.15f;  // frame the effect's bounds with this margin
        public float orthoSize = 0f;   // > 0: fixed frame (half height in world units) around `center` instead of auto bounds
        public Vector3 center;
        public float trim = 0.005f;    // auto frame: drop this share of lit-pixel mass on each side
        public float yaw = 0f;         // camera heading in degrees
        public float pxPerUnit = 0f;   // > 0: fixed scale, the auto frame only re-centres
        public bool captureReference = false;
    }

    const string LoadedKey = "ArkVfxRecorder.loadedBundleNames";

    public static string Load(string listFile)
    {
        Unload();
        var loaded = new List<string>();
        var names = new List<string>();
        foreach (var raw in File.ReadAllLines(listFile))
        {
            var p = raw.Trim();
            if (p.Length == 0 || !p.EndsWith(".ab")) continue;
            var b = AssetBundle.LoadFromFile(p);
            if (b != null) { s_bundles.Add(b); names.Add(b.name); loaded.Add(Path.GetFileName(p)); }
            else loaded.Add("FAILED " + Path.GetFileName(p));
        }
        SessionState.SetString(LoadedKey, string.Join("|", names));
        return string.Join(", ", loaded);
    }

    /// <summary>Unloads ours, including bundles left loaded by a previous script reload (the static list does not survive one).</summary>
    public static string Unload()
    {
        foreach (var b in s_bundles) if (b != null) b.Unload(true);
        s_bundles.Clear();
        var known = new HashSet<string>(SessionState.GetString(LoadedKey, "").Split(new[] { '|' }, StringSplitOptions.RemoveEmptyEntries));
        int stale = 0;
        foreach (var b in AssetBundle.GetAllLoadedAssetBundles().ToList())
            if (b != null && known.Contains(b.name)) { b.Unload(true); stale++; }
        SessionState.EraseString(LoadedKey);
        return "unloaded" + (stale > 0 ? $" (+{stale} left over from a reload)" : "");
    }

    public static string ListPrefabs(string filter)
    {
        var names = new List<string>();
        foreach (var b in s_bundles)
            foreach (var n in b.GetAllAssetNames())
                if (n.EndsWith(".prefab") && (string.IsNullOrEmpty(filter) || n.Contains(filter))) names.Add(n);
        return string.Join("\n", names);
    }

    static GameObject FindPrefab(string name)
    {
        foreach (var b in s_bundles)
        {
            var hit = b.GetAllAssetNames().FirstOrDefault(n => Path.GetFileNameWithoutExtension(n) == name.ToLowerInvariant());
            if (hit != null) return b.LoadAsset<GameObject>(hit);
        }
        return null;
    }

    static bool HasAlpha(Texture t)
    {
        var t2 = t as Texture2D;
        if (t2 == null) return true;
        var f = t2.format;
        return !(f == TextureFormat.RGB24 || f == TextureFormat.ETC_RGB4 || f == TextureFormat.ETC2_RGB || f == TextureFormat.DXT1 || f == TextureFormat.RGB565);
    }

    /// <summary>
    /// The original shader lives in a bundle we do not have, so the material API cannot see its properties
    /// (HasProperty/GetTexture follow the shader). The saved values are still in the material: read them serialized.
    /// </summary>
    static (Dictionary<string, (Texture tex, Vector2 scale, Vector2 offset)> texs, Dictionary<string, Color> colors, Dictionary<string, float> floats) Saved(Material src)
    {
        var texs = new Dictionary<string, (Texture, Vector2, Vector2)>(); var colors = new Dictionary<string, Color>(); var floats = new Dictionary<string, float>();
        var so = new SerializedObject(src);
        var t = so.FindProperty("m_SavedProperties.m_TexEnvs");
        for (int i = 0; t != null && i < t.arraySize; i++)
        {
            var e = t.GetArrayElementAtIndex(i);
            var v = e.FindPropertyRelative("second");
            texs[e.FindPropertyRelative("first").stringValue] = (v.FindPropertyRelative("m_Texture").objectReferenceValue as Texture, v.FindPropertyRelative("m_Scale").vector2Value, v.FindPropertyRelative("m_Offset").vector2Value);
        }
        var c = so.FindProperty("m_SavedProperties.m_Colors");
        for (int i = 0; c != null && i < c.arraySize; i++) { var e = c.GetArrayElementAtIndex(i); colors[e.FindPropertyRelative("first").stringValue] = e.FindPropertyRelative("second").colorValue; }
        var f = so.FindProperty("m_SavedProperties.m_Floats");
        for (int i = 0; f != null && i < f.arraySize; i++) { var e = f.GetArrayElementAtIndex(i); floats[e.FindPropertyRelative("first").stringValue] = e.FindPropertyRelative("second").floatValue; }
        return (texs, colors, floats);
    }

    static bool UsingUrp => GraphicsSettings.currentRenderPipeline != null;

    /// <summary>Torappu shader name -> (HLSL port in Assets/Editor/ArkVfx/Shaders, fixed property values the original hard-codes).</summary>
    static readonly Dictionary<string, (string port, Dictionary<string, float> set)> Ports = new Dictionary<string, (string, Dictionary<string, float>)>
    {
        ["Torappu/Particles/AlphaBlend"] = ("ArkVfx/Torappu/Simple", new Dictionary<string, float> { ["_ArkSrc"] = 5, ["_ArkDst"] = 10 }),
        ["Torappu/Particles/Additive"] = ("ArkVfx/Torappu/Simple", new Dictionary<string, float> { ["_ArkSrc"] = 5, ["_ArkDst"] = 1 }),
        ["Torappu/Particles/ZDistort/AlphaBlend"] = ("ArkVfx/Torappu/Simple", new Dictionary<string, float> { ["_ArkSrc"] = 5, ["_ArkDst"] = 10 }),
        ["Torappu/Particles/ZDistort/Additive"] = ("ArkVfx/Torappu/Simple", new Dictionary<string, float> { ["_ArkSrc"] = 5, ["_ArkDst"] = 1 }),
        ["Torappu/Particles/Dissolve/Dissolve AB"] = ("ArkVfx/Torappu/DissolveSimple", new Dictionary<string, float> { ["_ArkSrc"] = 5, ["_ArkDst"] = 10 }),
        ["Torappu/Particles/Dissolve/Dissolve Add"] = ("ArkVfx/Torappu/DissolveSimple", new Dictionary<string, float> { ["_ArkSrc"] = 5, ["_ArkDst"] = 1 }),
        // UVTween is the same dissolve edge with a time-varying main/dissolve
        // UV pair. Keeping it on the dissolve port avoids the URP particle
        // stand-in, which renders the opaque source quad as a large shadow.
        ["Torappu/Particles/Dissolve/Dissolve AB UVTween"] = ("ArkVfx/Torappu/DissolveSimple", new Dictionary<string, float> { ["_ArkSrc"] = 5, ["_ArkDst"] = 10 }),
        ["Torappu/Particles/Dissolve/Dissolve Add UVTween"] = ("ArkVfx/Torappu/DissolveSimple", new Dictionary<string, float> { ["_ArkSrc"] = 5, ["_ArkDst"] = 1 }),
        // The Double variants use two dissolve masks. They have their own port so the
        // source does not fall through to a transparent-quad stand-in.
        ["Torappu/Particles/Dissolve/Dissolve AB Double"] = ("ArkVfx/Torappu/DissolveDouble", new Dictionary<string, float> { ["_ArkSrc"] = 5, ["_ArkDst"] = 10 }),
        ["Torappu/Particles/Dissolve/Dissolve Add Double"] = ("ArkVfx/Torappu/DissolveDouble", new Dictionary<string, float> { ["_ArkSrc"] = 5, ["_ArkDst"] = 1 }),
        ["Torappu/Particles/Dissolve/Dissolve AB (VertexColor Major)"] = ("ArkVfx/Torappu/DissolveSimple", new Dictionary<string, float> { ["_ArkSrc"] = 5, ["_ArkDst"] = 10 }),
        ["Torappu/Particles/Dissolve/Dissolve Add (VertexColor Major)"] = ("ArkVfx/Torappu/DissolveSimple", new Dictionary<string, float> { ["_ArkSrc"] = 5, ["_ArkDst"] = 1 }),
        ["Torappu/Particles/Dissolve/Dissolve(CustomData)"] = ("ArkVfx/Torappu/DissolveCustom", new Dictionary<string, float>()),
        ["Torappu/Particles-L2D/Dissolve/Dissolve(CustomData)"] = ("ArkVfx/Torappu/L2DDissolveCustom", new Dictionary<string, float>()),
        ["Torappu/Particles/Ram/Add"] = ("ArkVfx/Torappu/Ram", new Dictionary<string, float> { ["_ArkDst"] = 1 }),
        ["Torappu/Particles/Ram/AlphaBlend"] = ("ArkVfx/Torappu/Ram", new Dictionary<string, float> { ["_ArkDst"] = 10 }),
        ["Torappu/Particles/Disturb/Disturb(CustomData)"] = ("ArkVfx/Torappu/DisturbCustom", new Dictionary<string, float> { ["_ArkRam"] = 0, ["_PremultiplyAlpha"] = 5 }),
        ["Torappu/Particles/Ram/Disturb(CustomData)"] = ("ArkVfx/Torappu/DisturbCustom", new Dictionary<string, float> { ["_ArkRam"] = 1 }),
        ["Torappu/Particles/Disturb/Disturb Origin"] = ("ArkVfx/Torappu/DisturbOrigin", new Dictionary<string, float>()),
        ["Torappu/Particles/Disturb/Disturb Anchor"] = ("ArkVfx/Torappu/DisturbOrigin", new Dictionary<string, float>()),
        ["Torappu/Particles/AlphaBlend(ZWrite)"] = ("ArkVfx/Torappu/Rim", new Dictionary<string, float> { ["_ArkSrc"] = 5, ["_ArkDst"] = 10, ["_ArkVertexRim"] = 0 }),
        ["Torappu/Particles/Rim/Rim Texture (Add)"] = ("ArkVfx/Torappu/Rim", new Dictionary<string, float> { ["_ArkSrc"] = 5, ["_ArkDst"] = 1, ["_ArkVertexRim"] = 1, ["_CullMode"] = 2 }),
        ["Torappu/Particles/Rim/Rim Tint (Add)"] = ("ArkVfx/Torappu/Rim", new Dictionary<string, float> { ["_ArkSrc"] = 5, ["_ArkDst"] = 1, ["_ArkVertexRim"] = 1, ["_CullMode"] = 2 }),
    };

    /// <summary>Shader names we had no port for during the last swap (reported in meta.json).</summary>
    static readonly HashSet<string> s_unported = new HashSet<string>();

    static IEnumerable<string> SavedKeywords(Material src)
    {
        var so = new SerializedObject(src);
        foreach (var name in new[] { "m_ValidKeywords", "m_InvalidKeywords" })
        {
            var p = so.FindProperty(name);
            for (int i = 0; p != null && p.isArray && i < p.arraySize; i++) yield return p.GetArrayElementAtIndex(i).stringValue;
        }
        var legacy = so.FindProperty("m_ShaderKeywords");
        if (legacy != null && legacy.propertyType == SerializedPropertyType.String)
            foreach (var k in legacy.stringValue.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries)) yield return k;
    }

    /// <summary>
    /// The original material on its HLSL port: same saved values and keywords; properties the original shader does not
    /// declare go back to the port's defaults so stale leftovers in the material cannot leak in.
    /// </summary>
    static Material Port(Material src)
    {
        if (!Ports.TryGetValue(src.shader.name, out var port)) return null;
        var target = Shader.Find(port.port);
        if (target == null || !target.isSupported || ShaderUtil.ShaderHasError(target)) return null;
        var declared = new HashSet<string>();
        for (int i = 0; i < src.shader.GetPropertyCount(); i++) declared.Add(src.shader.GetPropertyName(i));
        var m = new Material(src) { name = src.name + " (port)" };
        int queue = src.renderQueue;
        m.shader = target;
        for (int i = 0; i < target.GetPropertyCount(); i++)
        {
            var n = target.GetPropertyName(i);
            if (declared.Contains(n) || n.StartsWith("_Ark")) continue;
            switch (target.GetPropertyType(i))
            {
                case ShaderPropertyType.Float: case ShaderPropertyType.Range: m.SetFloat(n, target.GetPropertyDefaultFloatValue(i)); break;
                case ShaderPropertyType.Color: m.SetColor(n, target.GetPropertyDefaultVectorValue(i)); break;
                case ShaderPropertyType.Vector: m.SetVector(n, target.GetPropertyDefaultVectorValue(i)); break;
                case ShaderPropertyType.Texture: m.SetTexture(n, null); break;
            }
        }
        foreach (var kv in port.set) m.SetFloat(kv.Key, kv.Value);
        foreach (var k in SavedKeywords(src))
            if (k == "_HGCUSTOMVERTEXSTREAM_ON" || k == "HG_SPRITE_SHEET" || k == "HG_SPRITE_SHEET_LERP") m.EnableKeyword(k);
        m.renderQueue = queue;
        return m;
    }

    /// <summary>Stand-in particle material: the HLSL port of the original Torappu shader when there is one; otherwise a guess on URP or legacy particle shaders.</summary>
    static Material Replace(Material src)
    {
        var ported = Port(src);
        if (ported != null) return ported;
        s_unported.Add(src.shader.name);
        var (texs, colors, floats) = Saved(src);
        texs.TryGetValue("_MainTex", out var main);
        Texture tex = main.tex;
        Color c = Color.white; bool tint = false;
        if (colors.TryGetValue("_TintColor", out var tc)) { c = tc; tint = true; }
        else if (colors.TryGetValue("_MainColor", out var mc)) c = mc;
        else if (colors.TryGetValue("_Color", out var cc)) c = cc;
        float dst = floats.TryGetValue("_DstBlend", out var d) ? d : 0f;
        bool additive = dst == (float)BlendMode.One || (dst != (float)BlendMode.OneMinusSrcAlpha && (tex == null || !HasAlpha(tex) || tint));
        Material m;
        if (UsingUrp)
        {
            m = new Material(Shader.Find("Universal Render Pipeline/Particles/Unlit")) { name = src.name + " (stand-in)" };
            if (tex != null) { m.SetTexture("_BaseMap", tex); m.SetTextureScale("_BaseMap", main.scale); m.SetTextureOffset("_BaseMap", main.offset); }
            m.SetColor("_BaseColor", tint ? c * 2f : c);
            m.SetFloat("_Surface", 1f); m.SetFloat("_Blend", additive ? 2f : 0f);
            m.SetFloat("_SrcBlend", (float)BlendMode.SrcAlpha); m.SetFloat("_DstBlend", additive ? (float)BlendMode.One : (float)BlendMode.OneMinusSrcAlpha);
            m.SetFloat("_ZWrite", 0f); m.SetFloat("_Cull", 0f); m.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
        }
        else
        {
            // legacy particle shaders already use _MainTex + _TintColor (0.5 grey = neutral), the original's own convention
            m = new Material(Shader.Find(additive ? "Legacy Shaders/Particles/Additive" : "Legacy Shaders/Particles/Alpha Blended")) { name = src.name + " (stand-in)" };
            if (tex != null) { m.SetTexture("_MainTex", tex); m.SetTextureScale("_MainTex", main.scale); m.SetTextureOffset("_MainTex", main.offset); }
            m.SetColor("_TintColor", tint ? c : c * 0.5f);
        }
        m.renderQueue = (int)RenderQueue.Transparent;
        return m;
    }

    static int SwapShaders(GameObject root)
    {
        s_unported.Clear();
        var cache = new Dictionary<Material, Material>();
        int n = 0;
        foreach (var r in root.GetComponentsInChildren<Renderer>(true))
        {
            var mats = r.sharedMaterials;
            for (int i = 0; i < mats.Length; i++)
            {
                if (mats[i] == null || cache.ContainsValue(mats[i])) continue;
                if (!cache.TryGetValue(mats[i], out var rep)) { rep = Replace(mats[i]); cache[mats[i]] = rep; n++; }
                mats[i] = rep;
            }
            r.sharedMaterials = mats;
            // a particle renderer's trail material is its second material slot, usually already swapped just above
            if (r is ParticleSystemRenderer psr && psr.trailMaterial != null && !cache.ContainsValue(psr.trailMaterial))
            {
                if (!cache.TryGetValue(psr.trailMaterial, out var trail)) { trail = Replace(psr.trailMaterial); cache[psr.trailMaterial] = trail; }
                psr.trailMaterial = trail;
            }
        }
        return n;
    }

    /// <summary>Union of what actually draws (enabled, active, has a material, and for particles: has particles) over sampled times.</summary>
    static Bounds DrawnBounds(GameObject go, List<ParticleSystem> tops, float seconds)
    {
        bool any = false;
        var bounds = new Bounds(go.transform.position, Vector3.one * 0.5f);
        for (int k = 1; k <= 12; k++)
        {
            Step(go, tops, seconds * k / 12f, 0f, true);
            foreach (var r in go.GetComponentsInChildren<Renderer>(false))
            {
                if (!r.enabled || r.sharedMaterial == null) continue;
                if (r is ParticleSystemRenderer && r.GetComponent<ParticleSystem>().particleCount == 0) continue;
                if (r.bounds.size.sqrMagnitude <= 0f || r.bounds.size.magnitude > 30f) continue;
                if (!any) { bounds = r.bounds; any = true; } else bounds.Encapsulate(r.bounds);
            }
        }
        return bounds;
    }

    /// <summary>
    /// Renderer bounds overstate particles badly (13x15 units for a hit spark about 1 unit wide), so frame by what
    /// lands on screen: render the clip small on black through the wide camera, union the lit-pixel boxes, zoom to it.
    /// </summary>
    static void FitByPixels(Camera cam, GameObject go, List<ParticleSystem> tops, Job job, int frames)
    {
        const int pw = 320; int ph = Mathf.Max(1, pw * job.height / job.width);
        var rt = new RenderTexture(pw, ph, 24, RenderTextureFormat.ARGB32);
        var tex = new Texture2D(pw, ph, TextureFormat.RGBA32, false);
        cam.targetTexture = rt; cam.backgroundColor = Color.black;
        var colMass = new double[pw]; var rowMass = new double[ph];
        float dt = 1f / job.fps;
        Step(go, tops, 0f, 0f, true);
        for (int f = 0; f < frames; f++)
        {
            if (f > 0) Step(go, tops, f * dt, dt, false);
            if (f % 2 != 0) continue;
            cam.Render();
            var prev = RenderTexture.active; RenderTexture.active = rt;
            tex.ReadPixels(new Rect(0, 0, pw, ph), 0, 0); tex.Apply();
            RenderTexture.active = prev;
            var px = tex.GetPixels32();
            for (int y = 0; y < ph; y++)
                for (int x = 0; x < pw; x++)
                {
                    var c = px[y * pw + x];
                    int v = Mathf.Max(c.r, Mathf.Max(c.g, c.b));
                    if (v <= 10) continue;
                    colMass[x] += v; rowMass[y] += v;
                }
        }
        cam.targetTexture = null; UnityEngine.Object.DestroyImmediate(rt); UnityEngine.Object.DestroyImmediate(tex);
        // brightness-weighted percentiles, so a few stray sparks drifting off do not set the frame
        int x0 = Percentile(colMass, job.trim), x1 = Percentile(colMass, 1f - job.trim), y0 = Percentile(rowMass, job.trim), y1 = Percentile(rowMass, 1f - job.trim);
        if (x0 < 0) return; // nothing lit: keep the wide frame
        float worldPerPx = cam.orthographicSize * 2f / ph;
        float cx = ((x0 + x1 + 1) * 0.5f - pw * 0.5f) * worldPerPx, cy = ((y0 + y1 + 1) * 0.5f - ph * 0.5f) * worldPerPx;
        float halfW = (x1 - x0 + 1) * 0.5f * worldPerPx, halfH = (y1 - y0 + 1) * 0.5f * worldPerPx;
        cam.transform.position += cam.transform.right * cx + cam.transform.up * cy;
        // fixed scale (every effect of an operator shares it, so they line up with the character); otherwise zoom to fit
        cam.orthographicSize = job.pxPerUnit > 0f ? job.height / (2f * job.pxPerUnit) : Mathf.Max(halfH, halfW * job.height / job.width) * job.padding + 2f * worldPerPx;
    }

    /// <summary>Clip length from the content: delay + duration (2.5 s for loops) + longest lifetime, animator clips; 0.5..4 s.</summary>
    static float AutoSeconds(GameObject go)
    {
        float t = 0.5f;
        foreach (var ps in go.GetComponentsInChildren<ParticleSystem>(true))
        {
            var m = ps.main;
            float life = m.startLifetime.mode == ParticleSystemCurveMode.Constant ? m.startLifetime.constant : m.startLifetime.mode == ParticleSystemCurveMode.TwoConstants ? m.startLifetime.constantMax : m.startLifetime.curveMultiplier;
            float delay = m.startDelay.mode == ParticleSystemCurveMode.TwoConstants ? m.startDelay.constantMax : m.startDelay.constant;
            t = Mathf.Max(t, delay + (m.loop ? 2.5f : m.duration) + life);
        }
        foreach (var an in go.GetComponentsInChildren<Animator>(true))
            if (an.runtimeAnimatorController != null) foreach (var c in an.runtimeAnimatorController.animationClips) t = Mathf.Max(t, c.isLooping ? 2.5f : c.length);
        foreach (var leg in go.GetComponentsInChildren<Animation>(true)) if (leg.clip != null) t = Mathf.Max(t, leg.clip.length);
        return Mathf.Clamp(t, 0.5f, 4f);
    }

    static int Percentile(double[] mass, float q)
    {
        double total = mass.Sum(); if (total <= 0) return -1;
        double acc = 0;
        for (int i = 0; i < mass.Length; i++) { acc += mass[i]; if (acc >= total * q) return i; }
        return mass.Length - 1;
    }

    static void Step(GameObject root, List<ParticleSystem> tops, float t, float dt, bool restart)
    {
        Shader.SetGlobalVector("_ArkCaptureTime", new Vector4(t / 20f, t, t * 2f, t * 3f));
        foreach (var ps in tops) ps.Simulate(restart ? t : dt, true, restart, true);
        foreach (var an in root.GetComponentsInChildren<Animator>(true))
        {
            if (an.runtimeAnimatorController == null) continue;
            // a restart must rewind the animator too, or every probe pass leaves it further along the clip
            if (restart) { an.Rebind(); an.Update(0f); if (t > 0f) an.Update(t); }
            else an.Update(dt);
        }
        foreach (var leg in root.GetComponentsInChildren<Animation>(true)) { if (leg.clip != null) leg.clip.SampleAnimation(leg.gameObject, t); }
    }

    /// <summary>Where does a recording go dark: particle counts after simulation, renderer state, and whether URP draws a plain cube in a preview scene.</summary>
    public static string Diagnose(string jobFile)
    {
        var job = JsonUtility.FromJson<Job>(File.ReadAllText(jobFile));
        var prefab = FindPrefab(job.prefab);
        if (prefab == null) return "prefab not found";
        Scene scene = EditorSceneManager.NewPreviewScene();
        var lines = new List<string>();
        GameObject go = null, cube = null, camGo = null;
        try
        {
            go = (GameObject)UnityEngine.Object.Instantiate(prefab);
            SceneManager.MoveGameObjectToScene(go, scene);
            lines.Add("pipeline=" + (GraphicsSettings.currentRenderPipeline ? GraphicsSettings.currentRenderPipeline.name : "built-in"));
            foreach (var r in go.GetComponentsInChildren<Renderer>(true).Where(r => r.sharedMaterial != null).Take(4))
            {
                var (texs, colors, floats) = Saved(r.sharedMaterial);
                lines.Add($"source {r.name} shader={r.sharedMaterial.shader.name} supported={r.sharedMaterial.shader.isSupported} texs=[{string.Join(",", texs.Select(kv => kv.Key + ":" + (kv.Value.tex ? kv.Value.tex.name : "null")))}] colors=[{string.Join(",", colors.Keys)}] floats=[{string.Join(",", floats.Select(kv => kv.Key + "=" + kv.Value))}]");
            }
            SwapShaders(go);
            var all = go.GetComponentsInChildren<ParticleSystem>(true);
            var tops = all.Where(p => p.transform.parent == null || p.transform.parent.GetComponentInParent<ParticleSystem>() == null).ToList();
            foreach (var t in new[] { 0.1f, 0.3f, 0.6f })
            {
                Step(go, tops, t, 0f, true);
                lines.Add($"t={t} alive={all.Sum(p => p.particleCount)} systems={all.Length} playing={all.Count(p => p.isPlaying)} activeGOs={all.Count(p => p.gameObject.activeInHierarchy)}");
            }
            foreach (var r in go.GetComponentsInChildren<Renderer>(true).Take(6))
                lines.Add($"renderer {r.name} {r.GetType().Name} enabled={r.enabled} active={r.gameObject.activeInHierarchy} mat={(r.sharedMaterial ? r.sharedMaterial.shader.name : "null")} tex={(r.sharedMaterial && r.sharedMaterial.mainTexture ? r.sharedMaterial.mainTexture.name + "/" + ((Texture2D)r.sharedMaterial.mainTexture).format : "none")} bounds={r.bounds.size}");
            lines.Add("root active=" + go.activeSelf + " pos=" + go.transform.position + " scale=" + go.transform.lossyScale);
            var db = DrawnBounds(go, tops, job.seconds);
            lines.Add($"drawn bounds centre={db.center} size={db.size}");

            cube = GameObject.CreatePrimitive(PrimitiveType.Cube);
            SceneManager.MoveGameObjectToScene(cube, scene);
            cube.GetComponent<Renderer>().sharedMaterial = new Material(Shader.Find(UsingUrp ? "Universal Render Pipeline/Unlit" : "Unlit/Color")) { color = Color.red };
            camGo = new GameObject("ArkVfxDiagCam"); SceneManager.MoveGameObjectToScene(camGo, scene);
            var cam = camGo.AddComponent<Camera>(); cam.scene = scene; cam.transform.position = new Vector3(0, 0, -5);
            cam.clearFlags = CameraClearFlags.SolidColor; cam.backgroundColor = Color.black;
            foreach (var type in new[] { CameraType.Game, CameraType.Preview })
            {
                cam.cameraType = type;
                var rt = new RenderTexture(64, 64, 24); cam.targetTexture = rt; cam.Render();
                var prev = RenderTexture.active; RenderTexture.active = rt;
                var tex = new Texture2D(64, 64, TextureFormat.RGBA32, false); tex.ReadPixels(new Rect(0, 0, 64, 64), 0, 0); tex.Apply();
                RenderTexture.active = prev; cam.targetTexture = null;
                lines.Add($"cube test cameraType={type} centre pixel={tex.GetPixel(32, 32)}");
                UnityEngine.Object.DestroyImmediate(tex); UnityEngine.Object.DestroyImmediate(rt);
            }
        }
        catch (Exception e) { lines.Add("error " + e); }
        finally
        {
            if (go) UnityEngine.Object.DestroyImmediate(go);
            if (cube) UnityEngine.Object.DestroyImmediate(cube);
            if (camGo) UnityEngine.Object.DestroyImmediate(camGo);
            EditorSceneManager.ClosePreviewScene(scene);
        }
        return string.Join("\n", lines);
    }

    /// <summary>Hierarchy of one effect: local transforms and how each renderer faces the camera (to pick the viewing angle).</summary>
    public static string Tree(string prefabName)
    {
        var prefab = FindPrefab(prefabName);
        if (prefab == null) return "prefab not found";
        var lines = new List<string>();
        void Walk(Transform t, int depth)
        {
            var s = $"{new string(' ', depth * 2)}{t.name} active={t.gameObject.activeSelf} pos={t.localPosition} rot={t.localEulerAngles} scale={t.localScale}";
            var ps = t.GetComponent<ParticleSystem>();
            if (ps != null)
            {
                var m = ps.main; var psr = t.GetComponent<ParticleSystemRenderer>();
                s += $" | PS space={m.simulationSpace} scaling={m.scalingMode} dur={m.duration} loop={m.loop} delay={m.startDelay.constant} life={m.startLifetime.constant}/{m.startLifetime.constantMax} size={m.startSize.constant}/{m.startSize.constantMax} speed={m.startSpeed.constant}/{m.startSpeed.constantMax} 3Drot={m.startRotation3D} shape={(ps.shape.enabled ? ps.shape.shapeType.ToString() : "off")}";
                if (psr != null) s += $" render={psr.renderMode} align={psr.alignment} enabled={psr.enabled}";
            }
            else if (t.GetComponent<MeshRenderer>() != null) s += $" | Mesh {t.GetComponent<MeshFilter>()?.sharedMesh?.name}";
            if (t.GetComponent<Animator>() != null) s += " | Animator";
            if (t.GetComponent<TrailRenderer>() != null) s += " | Trail";
            if (t.GetComponent<LineRenderer>() != null) s += " | Line";
            foreach (var c in t.GetComponents<MonoBehaviour>()) s += " | MB " + (c == null ? "missing-script" : c.GetType().Name);
            lines.Add(s);
            foreach (Transform c in t) Walk(c, depth + 1);
        }
        Walk(prefab.transform, 0);
        return string.Join("\n", lines);
    }

    /// <summary>
    /// One-shot batch entry, so no editor has to stay open:
    /// Unity -batchmode -projectPath … -executeMethod ArkVfxRecorder.Batch -arkList bundles.list -arkJobs jobsDir -arkSummary out.txt -logFile …
    /// Records every *.json job in jobsDir, writes one summary line per job, unloads and exits (1 if any job failed).
    /// </summary>
    public static void Batch()
    {
        var args = Environment.GetCommandLineArgs();
        string Arg(string k) { int i = Array.IndexOf(args, k); return i >= 0 && i + 1 < args.Length ? args[i + 1] : null; }
        string list = Arg("-arkList"), jobsDir = Arg("-arkJobs"), summary = Arg("-arkSummary");
        var lines = new List<string>();
        int code = 0;
        try
        {
            ShaderUtil.allowAsyncCompilation = false; // not persisted; the ports must be compiled before the first frame
            lines.Add("load: " + Load(list));
            foreach (var f in Directory.GetFiles(jobsDir, "*.json").OrderBy(x => x))
            {
                var r = Record(f);
                lines.Add(Path.GetFileName(f) + " " + r);
                if (r.Contains("\"error\"")) code = 1;
            }
        }
        catch (Exception e) { lines.Add("fatal " + e); code = 2; }
        finally
        {
            Unload();
            if (summary != null) File.WriteAllLines(summary, lines);
        }
        EditorApplication.Exit(code);
    }

    public static string Record(string jobFile)
    {
        var job = JsonUtility.FromJson<Job>(File.ReadAllText(jobFile));
        var prefab = FindPrefab(job.prefab);
        if (prefab == null) return "{\"error\":\"prefab not found: " + job.prefab + "\"}";
        if (Directory.Exists(job.outDir) && Directory.GetFileSystemEntries(job.outDir).Length != 0)
            return "{\"error\":\"output must be a new empty directory: " + job.outDir.Replace("\\", "/") + "\"}";
        Directory.CreateDirectory(job.outDir);

        Scene scene = EditorSceneManager.NewPreviewScene();
        GameObject go = null, camGo = null;
        try
        {
            go = (GameObject)UnityEngine.Object.Instantiate(prefab);
            SceneManager.MoveGameObjectToScene(go, scene);
            int swapped = SwapShaders(go);
            if (s_unported.Count != 0)
                return "{\"error\":\"unsupported source shaders\",\"prefab\":\"" + job.prefab +
                       "\",\"unportedShaders\":[" + string.Join(",", s_unported.Select(s => "\"" + s + "\"")) + "]}";
            foreach (var an in go.GetComponentsInChildren<Animator>(true)) { an.cullingMode = AnimatorCullingMode.AlwaysAnimate; an.Rebind(); }
            // fixed seeds: every pass (framing probe, recording) sees the same particles, and reruns reproduce
            uint seed = 1;
            foreach (var ps in go.GetComponentsInChildren<ParticleSystem>(true))
            {
                ps.Stop(false, ParticleSystemStopBehavior.StopEmittingAndClear);
                ps.useAutoRandomSeed = false;
                ps.randomSeed = unchecked(seed++ * 2654435761u);
            }
            var tops = go.GetComponentsInChildren<ParticleSystem>(true).Where(p => p.transform.parent == null || p.transform.parent.GetComponentInParent<ParticleSystem>() == null).ToList();

            // bounds over the whole clip (sampled) to frame the camera, unless the job fixes the frame
            if (job.seconds <= 0f) job.seconds = AutoSeconds(go);
            int frames = Mathf.Max(1, Mathf.RoundToInt(job.fps * job.seconds));
            var bounds = job.orthoSize > 0f ? new Bounds(job.center, new Vector3(job.orthoSize * 2f * job.width / job.height, job.orthoSize * 2f, job.orthoSize * 2f) / job.padding) : DrawnBounds(go, tops, job.seconds);

            camGo = new GameObject("ArkVfxCam");
            SceneManager.MoveGameObjectToScene(camGo, scene);
            var cam = camGo.AddComponent<Camera>();
            cam.scene = scene;
            cam.orthographic = true;
            float aspect = (float)job.width / job.height;
            cam.orthographicSize = Mathf.Max(bounds.extents.y, bounds.extents.x / aspect) * job.padding + 0.1f;
            camGo.transform.rotation = Quaternion.Euler(job.pitch, job.yaw, 0f);
            camGo.transform.position = bounds.center - camGo.transform.forward * (bounds.extents.magnitude + 10f);
            cam.nearClipPlane = 0.01f; cam.farClipPlane = bounds.extents.magnitude * 2f + 40f;
            cam.clearFlags = CameraClearFlags.SolidColor;
            cam.cameraType = CameraType.Game;

            if (job.orthoSize <= 0f) FitByPixels(cam, go, tops, job, frames);

            // Each frame is rendered twice at the same simulation state, on black and on white, into a half-float target
            // (additive light must not clip on white). Over black the result is the premultiplied colour P; over white it is
            // P + (1 - A), so coverage A = 1 - (white - black). Written as one PNG: [P | A] side by side.
            var rt = new RenderTexture(job.width, job.height, 24, RenderTextureFormat.ARGBHalf) { antiAliasing = 4 };
            cam.targetTexture = rt;
            var read = new Texture2D(job.width, job.height, TextureFormat.RGBAHalf, false, true);
            var outTex = new Texture2D(job.width * 2, job.height, TextureFormat.RGB24, false);
            var reference = job.captureReference ? new Texture2D(job.width, job.height, TextureFormat.RGB24, false) : null;
            if (reference != null) Directory.CreateDirectory(Path.Combine(job.outDir, "reference"));
            var outPx = new Color32[job.width * 2 * job.height];
            float dt = 1f / job.fps;
            Color[] Grab(Color bg)
            {
                cam.backgroundColor = bg; cam.Render();
                var prev = RenderTexture.active; RenderTexture.active = rt;
                read.ReadPixels(new Rect(0, 0, job.width, job.height), 0, 0); read.Apply();
                RenderTexture.active = prev;
                return read.GetPixels();
            }
            Step(go, tops, 0f, 0f, true);
            for (int f = 0; f < frames; f++)
            {
                if (f > 0) Step(go, tops, f * dt, dt, false);
                var b = Grab(Color.black); var w = Grab(Color.white);
                for (int y = 0; y < job.height; y++)
                    for (int x = 0; x < job.width; x++)
                    {
                        int i = y * job.width + x;
                        float a = Mathf.Clamp01(1f - ((w[i].r - b[i].r) + (w[i].g - b[i].g) + (w[i].b - b[i].b)) / 3f);
                        var p = b[i];
                        int oi = y * job.width * 2 + x;
                        outPx[oi] = new Color32((byte)(Mathf.Clamp01(p.r) * 255f + 0.5f), (byte)(Mathf.Clamp01(p.g) * 255f + 0.5f), (byte)(Mathf.Clamp01(p.b) * 255f + 0.5f), 255);
                        byte av = (byte)(a * 255f + 0.5f);
                        outPx[oi + job.width] = new Color32(av, av, av, 255);
                    }
                outTex.SetPixels32(outPx); outTex.Apply();
                File.WriteAllBytes(Path.Combine(job.outDir, $"f_{f:0000}.png"), outTex.EncodeToPNG());
                if (reference != null)
                {
                    var ground = Grab(new Color(58f / 255f, 64f / 255f, 70f / 255f, 1f));
                    reference.SetPixels32(ground.Select(c => (Color32)new Color(Mathf.Clamp01(c.r), Mathf.Clamp01(c.g), Mathf.Clamp01(c.b), 1f)).ToArray());
                    reference.Apply();
                    File.WriteAllBytes(Path.Combine(job.outDir, "reference", $"f_{f:0000}.png"), reference.EncodeToPNG());
                }
            }
            if (reference != null) UnityEngine.Object.DestroyImmediate(reference);
            cam.targetTexture = null; UnityEngine.Object.DestroyImmediate(rt); UnityEngine.Object.DestroyImmediate(read); UnityEngine.Object.DestroyImmediate(outTex);
            // where the effect's own origin lands in the frame (pixels from the top-left) and the scale, so the web side can anchor it
            var o = cam.WorldToViewportPoint(go.transform.position);
            var inv = System.Globalization.CultureInfo.InvariantCulture;
            string F(float v) => v.ToString("0.###", inv);
            var meta = $"{{\"prefab\":\"{job.prefab}\",\"frames\":{frames},\"fps\":{F(job.fps)},\"seconds\":{F(job.seconds)},\"layout\":\"premultiplied|coverage\",\"width\":{job.width},\"height\":{job.height},\"pitch\":{F(job.pitch)},\"yaw\":{F(job.yaw)}," +
                       $"\"originPx\":[{F(o.x * job.width)},{F((1f - o.y) * job.height)}],\"pxPerUnit\":{F(job.height / (2f * cam.orthographicSize))},\"orthoSize\":{F(cam.orthographicSize)}," +
                       $"\"swappedMaterials\":{swapped},\"particleRoots\":{tops.Count},\"unportedShaders\":[{string.Join(",", s_unported.Select(s => "\"" + s + "\""))}]}}";
            File.WriteAllText(Path.Combine(job.outDir, "meta.json"), meta);
            return meta;
        }
        catch (Exception e)
        {
            return "{\"error\":\"" + e.GetType().Name + ": " + e.Message.Replace("\"", "'") + "\"}";
        }
        finally
        {
            if (go != null) UnityEngine.Object.DestroyImmediate(go);
            if (camGo != null) UnityEngine.Object.DestroyImmediate(camGo);
            EditorSceneManager.ClosePreviewScene(scene);
        }
    }
}
