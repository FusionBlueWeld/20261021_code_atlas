"""Read-only source analysis for the local Code Atlas explorer."""
from .analysis import analyze
from .collection import collect_directory, discover_project_roots

__all__ = ['analyze', 'collect_directory', 'discover_project_roots']
