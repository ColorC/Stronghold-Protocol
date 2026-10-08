// Port of Torappu/Particles/Dissolve/Dissolve * Double.
// Both source dissolve masks gate the particle; the second mask is evaluated
// in the same UV space and preserves the edge widths from the original material.
Shader "ArkVfx/Torappu/DissolveDouble"
{
    Properties
    {
        _TintColor ("Tint Color", Color) = (0.5,0.5,0.5,0.5)
        _MainTex ("Particle Texture", 2D) = "white" {}
        _DissolveTex_01 ("DissolveTex 01", 2D) = "white" {}
        _DissolveTex_02 ("DissolveTex 02", 2D) = "white" {}
        _Amount_01 ("Amount 01", Range(0,1)) = 0.5
        _BorderWidth_01 ("Border Width 01", Range(0.0001,1)) = 0.1
        _Amount_02 ("Amount 02", Range(0,1)) = 0.5
        _BorderWidth_02 ("Border Width 02", Range(0.0001,1)) = 0.1
        _ZTest ("ZTest", Float) = 4
        _ArkSrc ("src blend", Float) = 5
        _ArkDst ("dst blend", Float) = 1
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
            sampler2D _MainTex, _DissolveTex_01, _DissolveTex_02;
            float4 _MainTex_ST, _DissolveTex_01_ST, _DissolveTex_02_ST;
            half4 _TintColor;
            half _Amount_01, _BorderWidth_01, _Amount_02, _BorderWidth_02;
            struct a2v { float4 vertex : POSITION; float4 uv : TEXCOORD0; half4 color : COLOR; };
            struct v2f { float4 pos : SV_POSITION; float4 uv0 : TEXCOORD0; float2 uv1 : TEXCOORD1; half4 color : COLOR; };
            v2f vert(a2v v)
            {
                v2f o; o.pos = UnityObjectToClipPos(v.vertex);
                o.uv0.xy = TRANSFORM_TEX(v.uv.xy, _MainTex);
                o.uv0.zw = TRANSFORM_TEX(v.uv.xy, _DissolveTex_01);
                o.uv1 = TRANSFORM_TEX(v.uv.xy, _DissolveTex_02);
                o.color = v.color * _TintColor;
                return o;
            }
            half4 frag(v2f i) : SV_Target
            {
                half edge1 = ArkDissolve(tex2D(_DissolveTex_01, i.uv0.zw).r, _Amount_01, _BorderWidth_01);
                half edge2 = ArkDissolve(tex2D(_DissolveTex_02, i.uv1).r, _Amount_02, _BorderWidth_02);
                half4 c = (i.color + i.color) * tex2D(_MainTex, i.uv0.xy);
                c.a = saturate(edge1 * edge2 * c.a);
                return c;
            }
            ENDCG
        }
    }
}
