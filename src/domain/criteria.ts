import { z } from "zod";

// 記事を「Hot」と判定する基準(criteria.jsonの形式)
export const CriteriaSchema = z.object({
	themes: z.array(z.string()).min(1),
	rejects: z.array(z.string()).min(1),
});

export type Criteria = z.infer<typeof CriteriaSchema>;
