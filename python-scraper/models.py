from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any

class TransformRequest(BaseModel):
    entityType: str
    value: str
    platform: Optional[str] = None
    transformType: str = "profile"
    options: Dict[str, Any] = Field(default_factory=dict)

class OsintEntity(BaseModel):
    id: str
    type: str
    label: str
    platform: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None

class OsintRelation(BaseModel):
    id: str
    sourceId: str
    targetId: str
    label: str

class TransformResponse(BaseModel):
    success: bool
    entities: List[OsintEntity] = Field(default_factory=list)
    relations: List[OsintRelation] = Field(default_factory=list)
    source: str
    rawData: Dict[str, Any] = Field(default_factory=dict)
    error: Optional[str] = None

