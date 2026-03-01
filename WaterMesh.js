import {
	Color,
	Mesh,
	Vector2,
	Vector3,
	NodeMaterial
} from 'three/webgpu';

import { Fn, add, cameraPosition, div, dot, exp, float, If, length, max, mix, mul, normalize, positionLocal, positionWorld, pow, reflect, reflector, step, sub, time, texture, uniform, vec2, vec3, sin } from 'three/tsl';

/**
 * A basic flat, reflective water effect.
 *
 * Note that this class can only be used with {@link WebGPURenderer}.
 * When using {@link WebGLRenderer}, use {@link Water}.
 *
 * References:
 *
 * - [Flat mirror for three.js](https://github.com/Slayvin)
 * - [An implementation of water shader based on the flat mirror](https://home.adelphi.edu/~stemkoski/)
 * - [Water shader explanations in WebGL](http://29a.ch/slides/2012/webglwater/ )
 *
 * @augments Mesh
 * @three_import import { WaterMesh } from 'three/addons/objects/WaterMesh.js';
 */
class WaterMesh extends Mesh {

	/**
	 * Constructs a new water mesh.
	 *
	 * @param {BufferGeometry} geometry - The water mesh's geometry.
	 * @param {WaterMesh~Options} [options] - The configuration options.
	 */
	constructor( geometry, options ) {

		const material = new NodeMaterial();

		super( geometry, material );

		/**
		 * This flag can be used for type testing.
		 *
		 * @type {boolean}
		 * @readonly
		 * @default true
		 */
		this.isWaterMesh = true;

		/**
		 * The effect's resolution scale.
		 *
		 * @type {number}
		 * @default 0.5
		 */
		this.resolutionScale = options.resolutionScale !== undefined ? options.resolutionScale : 0.5;

		// Uniforms

		/**
		 * The water's normal map.
		 *
		 * @type {TextureNode}
		 */
		this.waterNormals = texture( options.waterNormals );

		/**
		 * The alpha value.
		 *
		 * @type {UniformNode<float>}
		 * @default 1
		 */
		this.alpha = uniform( options.alpha !== undefined ? options.alpha : 1.0 );

		/**
		 * The size value.
		 *
		 * @type {UniformNode<float>}
		 * @default 1
		 */
		this.size = uniform( options.size !== undefined ? options.size : 1.0 );

		/**
		 * The sun color.
		 *
		 * @type {UniformNode<color>}
		 * @default 0xffffff
		 */
		this.sunColor = uniform( new Color( options.sunColor !== undefined ? options.sunColor : 0xffffff ) );

		/**
		 * The sun direction.
		 *
		 * @type {UniformNode<vec3>}
		 * @default (0.70707,0.70707,0.0)
		 */
		this.sunDirection = uniform( options.sunDirection !== undefined ? options.sunDirection : new Vector3( 0.70707, 0.70707, 0.0 ) );

		/**
		 * The water color.
		 *
		 * @type {UniformNode<color>}
		 * @default 0x7f7f7f
		 */
		this.waterColor = uniform( new Color( options.waterColor !== undefined ? options.waterColor : 0x7f7f7f ) );

		/**
		 * The distortion scale.
		 *
		 * @type {UniformNode<float>}
		 * @default 20
		 */
		this.distortionScale = uniform( options.distortionScale !== undefined ? options.distortionScale : 20.0 );

		/**
		 * Base ocean wave animation speed (multiplier on time).
		 * @type {UniformNode<float>}
		 * @default 1
		 */
		this.waveTimeScale = uniform( options.waveTimeScale !== undefined ? options.waveTimeScale : 1.0 );

		// Click ripples (world XZ position and time; times < 0 = inactive)
		this.ripplePos0 = uniform( new Vector2( 0, 0 ) );
		this.ripplePos1 = uniform( new Vector2( 0, 0 ) );
		this.ripplePos2 = uniform( new Vector2( 0, 0 ) );
		this.ripplePos3 = uniform( new Vector2( 0, 0 ) );
		this.rippleTime0 = uniform( - 1000 );
		this.rippleTime1 = uniform( - 1000 );
		this.rippleTime2 = uniform( - 1000 );
		this.rippleTime3 = uniform( - 1000 );
		this.rippleAmplitude = uniform( options.rippleAmplitude !== undefined ? options.rippleAmplitude : 8 );
		this.rippleWavelength = uniform( options.rippleWavelength !== undefined ? options.rippleWavelength : 0.08 );
		this.rippleSpeed = uniform( options.rippleSpeed !== undefined ? options.rippleSpeed : 2.5 );
		this.rippleDecay = uniform( options.rippleDecay !== undefined ? options.rippleDecay : 0.4 );

		// TSL

		const rippleDisplacement = Fn( () => {

			const pw = positionWorld.xz;
			const ripple = Fn( ( [ pos, t ] ) => {

				const d = length( pw.sub( pos ) );
				const age = time.sub( t );
				const active = step( float( 0 ), age );
				const wave = sin( d.mul( this.rippleWavelength ).sub( age.mul( this.rippleSpeed ) ) );
				const decay = exp( age.negate().mul( this.rippleDecay ) );
				return active.mul( this.rippleAmplitude ).mul( wave ).mul( decay );

			} );

			const r0 = ripple( this.ripplePos0, this.rippleTime0 );
			const r1 = ripple( this.ripplePos1, this.rippleTime1 );
			const r2 = ripple( this.ripplePos2, this.rippleTime2 );
			const r3 = ripple( this.ripplePos3, this.rippleTime3 );
			return r0.add( r1 ).add( r2 ).add( r3 );

		} )();

		const getNoise = Fn( ( [ uv ] ) => {

			const offset = time.mul( this.waveTimeScale );

			const uv0 = add( div( uv, 103 ), vec2( div( offset, 17 ), div( offset, 29 ) ) ).toVar();
			const uv1 = div( uv, 107 ).sub( vec2( div( offset, - 19 ), div( offset, 31 ) ) ).toVar();
			const uv2 = add( div( uv, vec2( 8907.0, 9803.0 ) ), vec2( div( offset, 101 ), div( offset, 97 ) ) ).toVar();
			const uv3 = sub( div( uv, vec2( 1091.0, 1027.0 ) ), vec2( div( offset, 109 ), div( offset, - 113 ) ) ).toVar();

			const sample0 = this.waterNormals.sample( uv0 );
			const sample1 = this.waterNormals.sample( uv1 );
			const sample2 = this.waterNormals.sample( uv2 );
			const sample3 = this.waterNormals.sample( uv3 );

			const noise = sample0.add( sample1 ).add( sample2 ).add( sample3 );

			return noise.mul( 0.5 ).sub( 1 );

		} );

		const noise = getNoise( positionWorld.xz.mul( this.size ) );
		const surfaceNormal = normalize( noise.xzy.mul( 1.5, 1.0, 1.5 ) );

		const worldToEye = cameraPosition.sub( positionWorld );
		const eyeDirection = normalize( worldToEye );

		const reflection = normalize( reflect( this.sunDirection.negate(), surfaceNormal ) );
		const direction = max( 0.0, dot( eyeDirection, reflection ) );
		const specularLight = pow( direction, 100 ).mul( this.sunColor ).mul( 2.0 );
		const diffuseLight = max( dot( this.sunDirection, surfaceNormal ), 0.0 ).mul( this.sunColor ).mul( 0.5 );

		const distance = length( worldToEye );

		const distortion = surfaceNormal.xz.mul( float( 0.001 ).add( float( 1.0 ).div( distance ) ) ).mul( this.distortionScale );

		// Material

		material.transparent = true;

		material.opacityNode = this.alpha;

		material.positionNode = positionLocal.add( vec3( float( 0 ), rippleDisplacement, float( 0 ) ) );

		material.receivedShadowPositionNode = positionWorld.add( distortion );

		material.colorNode = Fn( () => {

			const mirrorSampler = reflector();
			mirrorSampler.uvNode = mirrorSampler.uvNode.add( distortion );
			mirrorSampler.reflector.resolutionScale = this.resolutionScale;

			this.add( mirrorSampler.target );

			const theta = max( dot( eyeDirection, surfaceNormal ), 0.0 );
			const rf0 = float( 0.02 );
			const reflectance = mul( pow( float( 1.0 ).sub( theta ), 5.0 ), float( 1.0 ).sub( rf0 ) ).add( rf0 );
			const scatter = max( 0.0, dot( surfaceNormal, eyeDirection ) ).mul( this.waterColor );
			const albedo = mix( this.sunColor.mul( diffuseLight ).mul( 0.3 ).add( scatter ), mirrorSampler.rgb.add( specularLight ), reflectance );

			return albedo;

		} )();

	}

}

/**
 * Constructor options of `WaterMesh`.
 *
 * @typedef {Object} WaterMesh~Options
 * @property {number} [resolutionScale=0.5] - The resolution scale.
 * @property {?Texture} [waterNormals=null] - The water's normal map.
 * @property {number} [alpha=1] - The alpha value.
 * @property {number} [size=1] - The size value.
 * @property {number|Color|string} [sunColor=0xffffff] - The sun color.
 * @property {Vector3} [sunDirection=(0.70707,0.70707,0.0)] - The sun direction.
 * @property {number|Color|string} [waterColor=0x7F7F7F] - The water color.
 * @property {number} [distortionScale=20] - The distortion scale.
 **/

export { WaterMesh };
