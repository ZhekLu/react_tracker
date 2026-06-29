from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class BundleValidation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    passed: bool
    errors: list[str] = Field(default_factory=list)


class NormalizedBundle(BaseModel):
    model_config = ConfigDict(extra="allow")

    bundle_version: Literal[1]
    generated_at: str
    load_order: list[str]
    target_schema: str
    validation: BundleValidation
    tables: dict[str, list[dict[str, Any]]]

    @model_validator(mode="after")
    def validate_bundle(self) -> NormalizedBundle:
        if not self.validation.passed:
            raise ValueError(f"Bundle validation failed: {self.validation.errors}")
        missing = set(self.load_order) - set(self.tables)
        if missing:
            raise ValueError(f"Bundle load order references missing tables: {sorted(missing)}")
        return self


class ImportTableResult(BaseModel):
    table: str
    input_rows: int
    written_rows: int


class NormalizedImportResult(BaseModel):
    source_path: str
    bundle_version: int
    tables: list[ImportTableResult]
    total_rows: int
