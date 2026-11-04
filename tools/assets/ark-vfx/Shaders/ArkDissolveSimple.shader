// Torappu/Particles/Dissolve/Dissolve AB and Dissolve Add (plus their "VertexColor Major" variants, mapped here too):
// colour = tex * 2 * vertexColour * _TintColor, alpha *= dissolve edge of _DissolveTex.r against _Amount.
Shader "ArkVfx/Torappu/DissolveSimple"
{
    Properties
    {
        _TintColor ("Tint Color", Color) = (0.5,0.5,0.5,0.5)
        _MainTex ("Particle Texture", 2D) = "white" {}
        _DissolveTex ("DissolveTex", 2D) = "white" {}
        _Amount ("Amount", Range(0,1)) = 0.5
        _BorderWidth ("Border Width", Range(0.0001,1)) = 0.1
        _UVTween ("UV Tween Main(xy), Dissolve(zw)", Vector) = (0,0,0,0)
        _ZTest ("ZTest", Float) = 4
        _ArkSrc ("src blend", Float) = 5
        _ArkDst ("dst blend", Float) = 10
    }
    SubShader
    {
        Tags { "Queue"="Transparent" "IgnoreProjector"="True" "RenderType"="Transparent" }
        Pass
        {
            Blend [_ArkSrc] [_ArkDst], Zero OneMinusSrcAlpha
            ZWrite Off ZTest [_ZTest] Cull Off
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "ArkTorappu.cginc"
            sampler2D _MainTex, _DissolveTex; float4 _MainTex_ST, _DissolveTex_ST; half4 _TintColor; half _Amount, _BorderWidth; float4 _UVTween;
            struct a2v { float4 vertex : POSITION; float4 uv : TEXCOORD0; half4 color : COLOR; };
            struct v2f { float4 pos : SV_POSITION; float4 uv : TEXCOORD0; half4 color : COLOR; };
            v2f vert(a2v v) { v2f o; o.pos = UnityObjectToClipPos(v.vertex); float2 m = TRANSFORM_TEX(v.uv.xy, _MainTex) + _Time.y * _UVTween.xy; float2 d = TRANSFORM_TEX(v.uv.xy, _DissolveTex) + _Time.y * _UVTween.zw; o.uv = float4(m, d); o.color = v.color * _TintColor; return o; }
            half4 frag(v2f i) : SV_Target
            {
                half edge = ArkDissolve(tex2D(_DissolveTex, i.uv.zw).r, _Amount, _BorderWidth);
                half4 c = (i.color + i.color) * tex2D(_MainTex, i.uv.xy);
                c.a = saturate(edge * c.a);
                return c;
            }
            ENDCG
        }
    }
}
