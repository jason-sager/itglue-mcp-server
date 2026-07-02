import { z } from "zod";
import { PaginationSchema, ResponseFormatSchema, SortSchema } from "./common.js";

export const ListConfigurationsSchema = z
  .object({
    organization_id: z
      .number()
      .int()
      .positive()
      .describe("Organization ID to list configurations for (required)"),
    filter_name: z
      .string()
      .optional()
      .describe(
        "Filter by configuration name (case-insensitive substring match, performed client-side over the full list)"
      ),
    filter_configuration_type_id: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Filter by configuration type ID (server-side exact match)"),
    filter_configuration_status_id: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Filter by configuration status ID (server-side exact match)"),
    sort: SortSchema,
    ...PaginationSchema,
    response_format: ResponseFormatSchema,
  })
  .strict();

export type ListConfigurationsInput = z.infer<typeof ListConfigurationsSchema>;

export const GetConfigurationSchema = z
  .object({
    configuration_id: z
      .number()
      .int()
      .positive()
      .describe("The configuration ID to retrieve"),
    response_format: ResponseFormatSchema,
  })
  .strict();

export type GetConfigurationInput = z.infer<typeof GetConfigurationSchema>;
