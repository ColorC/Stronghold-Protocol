// Source: Torappu/Particles/Ram/Add and Ram/AlphaBlend, shipped GLES3 programs.
// Both multiply MainTex * RamTex * 2 * vertex colour * TintColor; only the destination blend differs.
Shader "ArkVfx/Torappu/Ram"
{
    Properties
    {
        _TintColor ("Tint Color", Color) = (0.5,0.5,0.5,0.5)
        _MainTex ("Particle Texture", 2D) = "white" {}
        _RamTex ("Ram Texture", 2D) = "white" {}
        _ZTest ("ZTest", Float) = 4
        _ArkDst ("Destination Blend", Float) = 10
    }
    SubShader
    {
        Tags { "Queue"="Transparent" "IgnoreProjector"="True" "RenderType"="Transparent" }
        Pass
        {
            Blend SrcAlpha [_ArkDst], Zero OneMinusSrcAlpha
            ZWrite Off ZTest [_ZTest] Cull Off
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile __ HG_SPRITE_SHEET HG_SPRITE_SHEET_LERP
            #include "ArkTorappu.cginc"
            sampler2D _MainTex, _RamTex;
            float4 _MainTex_ST, _RamTex_ST;
            half4 _TintColor, _HGSpriteSheetParam, _HGExternalCtrl;
            struct a2v { float4 vertex : POSITION; float2 uv : TEXCOORD0; half4 color : COLOR; };
            struct v2f { float4 pos : SV_POSITION; float4 uv : TEXCOORD0; half4 color : COLOR; float4 sheet : TEXCOORD1; };
            v2f vert(a2v v)
            {
                v2f o;
                o.pos = UnityObjectToClipPos(v.vertex);
                o.uv = float4(TRANSFORM_TEX(v.uv, _MainTex), TRANSFORM_TEX(v.uv, _RamTex));
                o.color = v.color * _TintColor;
                o.sheet = 0;
                #if defined(HG_SPRITE_SHEET) || defined(HG_SPRITE_SHEET_LERP)
                float2 slot = _HGExternalCtrl.xy / _HGSpriteSheetParam.xx;
                float2 columns = sign(slot) * frac(abs(slot)) * _HGSpriteSheetParam.xx;
                o.sheet.xz = (columns + o.uv.xx) * _HGSpriteSheetParam.zz;
                o.sheet.yw = 1 - (floor(slot) + o.uv.yy) * _HGSpriteSheetParam.yy;
                #endif
                return o;
            }
            half4 frag(v2f i) : SV_Target
            {
                half4 main;
                #if defined(HG_SPRITE_SHEET) || defined(HG_SPRITE_SHEET_LERP)
                clip(_HGExternalCtrl.w - 0.1);
                main = tex2D(_MainTex, i.sheet.xy);
                #ifdef HG_SPRITE_SHEET_LERP
                main = lerp(main, tex2D(_MainTex, i.sheet.zw), _HGExternalCtrl.z);
                #endif
                #else
                main = tex2D(_MainTex, i.uv.xy);
                #endif
                half4 c = main * tex2D(_RamTex, i.uv.zw) * (i.color + i.color);
                c.a = saturate(c.a);
                return c;
            }
            ENDCG
        }
    }
}
