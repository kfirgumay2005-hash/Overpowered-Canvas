/** Stands in for the emoji data, which the build provides as a virtual module. A few emoji are enough for tests. */
export default {
	core: ["😀\t0\t", "👍\t1\t👍🏻,👍🏼,👍🏽,👍🏾,👍🏿", "🐶\t3\t", "🍕\t4\t", "🇯🇵\t9\t"].join("\n"),
	en: ["grinning face\tcheerful face grin happy smile", "thumbs up\t+1 good hand like yes", "dog face\tdog pet", "pizza\tcheese slice", "flag: Japan\tflag"].join("\n"),
	packs: {},
	version: "test",
};
