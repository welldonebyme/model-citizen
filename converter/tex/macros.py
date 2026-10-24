"""The explicit table of every macro and environment the book uses.

Anything not listed here is a HARD ERROR (file:line) -- the converter never drops unknown LaTeX silently.

Argument signature letters (xparse style):
    s  optional star          o  optional [..] kept raw     O  optional [..] parsed
    m  mandatory {..} parsed  r  mandatory {..} kept raw

Each macro also has a category used by the renderer:
    render   produces content (inline or block); handled explicitly in render/inline.py or render/blocks.py
    symbol   a fixed character (see SYMBOLS)
    math     a math-mode symbol (see MATH_SYMBOLS)
    layout   pure layout: dropped (its arguments are dropped too)
    decl     a declaration (font/size/colour switch): drops itself, but may restyle the rest of its group
    struct   document structure handled by the chapter builder
    table    table syntax handled by render/tables.py
    define   a definition; its source text must match converter/tex/definitions.py (hard error otherwise)
"""

MACROS: dict[str, tuple[str, str]] = {
    # ---------------------------------------------------------------- structure
    "part": ("sOm", "struct"),
    "chapter": ("sOm", "struct"),
    "section": ("sOm", "struct"),
    "subsection": ("sOm", "struct"),
    "subsubsection": ("sOm", "struct"),
    "paragraph": ("sOm", "render"),          # run-in heading -> {t:"h", level:4}
    "label": ("r", "render"),
    "ref": ("r", "render"),
    "input": ("r", "struct"),
    "caption": ("Om", "render"),
    "item": ("O", "struct"),
    "appendix": ("", "struct"),
    # ---------------------------------------------------------------- inline formatting
    "code": ("m", "render"),
    "texttt": ("m", "render"),
    "textbf": ("m", "render"),
    "emph": ("m", "render"),
    "textit": ("m", "render"),
    "textsf": ("m", "render"),
    "underline": ("m", "render"),
    "textrm": ("m", "render"),
    "mbox": ("m", "render"),
    "textcolor": ("rm", "render"),
    "colorbox": ("rm", "render"),
    "texorpdfstring": ("mr", "render"),
    "resizebox": ("rrm", "render"),
    "url": ("r", "render"),
    "href": ("rm", "render"),
    "newline": ("", "render"),
    "\\": ("so", "render"),
    # ---------------------------------------------------------------- book macros (preamble.tex)
    "term": ("mm", "render"),
    "key": ("m", "render"),
    "objective": ("r", "render"),
    "labtag": ("r", "render"),
    "mockkey": ("rrm", "render"),
    "mockreview": ("m", "render"),
    "checkbox": ("", "render"),
    "done": ("", "render"),
    # chapter-local macros (their definitions are checked in definitions.py)
    "cxxviitrap": ("mmm", "render"),
    "cxxviiwhere": ("m", "render"),
    "capscore": ("", "render"),
    # ---------------------------------------------------------------- icons (fontawesome5)
    "faCheck": ("", "render"),
    "faQuestionCircle": ("", "render"),
    "faCheckCircle": ("", "render"),
    "faInfoCircle": ("", "render"),
    "faProjectDiagram": ("", "render"),
    "faCertificate": ("", "render"),
    "faBookOpen": ("", "render"),
    "faLightbulb": ("", "render"),
    "faKey": ("", "render"),
    "faFlask": ("", "render"),
    "faExclamationTriangle": ("", "render"),
    "faSearch": ("", "render"),
    "faUsers": ("", "render"),
    "faListUl": ("", "render"),
    "faTag": ("", "render"),
    # ---------------------------------------------------------------- symbols (text mode)
    "ldots": ("", "symbol"),
    "dots": ("", "symbol"),
    "textasciitilde": ("", "symbol"),
    "textbackslash": ("", "symbol"),
    "textunderscore": ("", "symbol"),
    "textgreater": ("", "symbol"),
    "textless": ("", "symbol"),
    "textbar": ("", "symbol"),
    "_": ("", "symbol"),
    "%": ("", "symbol"),
    "#": ("", "symbol"),
    "&": ("", "symbol"),
    "$": ("", "symbol"),
    "{": ("", "symbol"),
    "}": ("", "symbol"),
    ",": ("", "symbol"),
    ";": ("", "symbol"),
    " ": ("", "symbol"),
    "^": ("m", "render"),            # \^{} -> "^"
    "enspace": ("", "symbol"),
    "quad": ("", "symbol"),
    "qquad": ("", "symbol"),
    # ---------------------------------------------------------------- math symbols (inside $..$)
    "rightarrow": ("", "math"),
    "Rightarrow": ("", "math"),
    "longrightarrow": ("", "math"),
    "longleftarrow": ("", "math"),
    "leftarrow": ("", "math"),
    "gets": ("", "math"),
    "to": ("", "math"),
    "geq": ("", "math"),
    "leq": ("", "math"),
    "times": ("", "math"),
    "neq": ("", "math"),
    "pm": ("", "math"),
    "approx": ("", "math"),
    "square": ("", "math"),
    "hookrightarrow": ("", "math"),
    # ---------------------------------------------------------------- layout (dropped with their args)
    "par": ("", "render"),           # paragraph break
    "medskip": ("", "layout"),
    "smallskip": ("", "layout"),
    "bigskip": ("", "layout"),
    "vspace": ("sr", "layout"),
    "hspace": ("sr", "render"),      # a space, or a blank inside \underline{}
    "noindent": ("", "layout"),
    "newpage": ("", "layout"),
    "clearpage": ("", "layout"),
    "centering": ("", "layout"),
    "raggedright": ("", "layout"),
    "sloppy": ("", "layout"),
    "allowbreak": ("", "layout"),
    "hfill": ("", "layout"),
    "hfil": ("", "layout"),
    "nobreak": ("", "layout"),
    "nopagebreak": ("", "layout"),
    "columnbreak": ("", "layout"),
    "begingroup": ("", "layout"),
    "endgroup": ("", "layout"),
    "arraybackslash": ("", "layout"),
    "rule": ("orr", "render"),       # a write-in line (answer sheets, tracker) -> {t:"blank"}
    "hrulefill": ("", "render"),     # idem
    # ---------------------------------------------------------------- declarations
    "small": ("", "decl"),
    "footnotesize": ("", "decl"),
    "scriptsize": ("", "decl"),
    "tiny": ("", "decl"),
    "large": ("", "decl"),
    "Large": ("", "decl"),
    "normalsize": ("", "decl"),
    "normalfont": ("", "decl"),
    "bfseries": ("", "decl"),
    "itshape": ("", "decl"),
    "ttfamily": ("", "decl"),
    "sffamily": ("", "decl"),
    "mdseries": ("", "decl"),
    "color": ("r", "decl"),
    # ---------------------------------------------------------------- tables
    "toprule": ("o", "table"),
    "midrule": ("o", "table"),
    "bottomrule": ("o", "table"),
    "hline": ("", "table"),
    "endhead": ("", "table"),
    "endfirsthead": ("", "table"),
    "multicolumn": ("rrm", "table"),
    # ---------------------------------------------------------------- definitions (checked verbatim)
    "newcommand": ("ror", "define"),
    "renewcommand": ("ror", "define"),
    "tcbset": ("r", "define"),
    "tikzset": ("r", "define"),
    "setlength": ("rr", "define"),
}

# Text-mode symbols. "~" and "&" are handled as Special nodes by the parser.
SYMBOLS: dict[str, str] = {
    "ldots": "…",
    "dots": "…",
    "textasciitilde": "~",
    "textbackslash": "\\",
    "textunderscore": "_",
    "textgreater": ">",
    "textless": "<",
    "textbar": "|",
    "_": "_",
    "%": "%",
    "#": "#",
    "&": "&",
    "$": "$",
    "{": "{",
    "}": "}",
    ",": " ",        # thin space (SCHEMA: "\, -> thin space")
    ";": " ",
    " ": " ",
    "enspace": " ",
    "quad": " ",
    "qquad": " ",
}

MATH_SYMBOLS: dict[str, str] = {
    "rightarrow": "→",
    "to": "→",
    "Rightarrow": "⇒",
    "longrightarrow": "⟶",
    "longleftarrow": "⟵",
    "leftarrow": "←",
    "gets": "←",
    "geq": "≥",
    "leq": "≤",
    "times": "×",
    "neq": "≠",
    "pm": "±",
    "approx": "≈",
    "square": "□",
    "hookrightarrow": "↪",
}

ICONS: dict[str, str] = {
    "faCheck": "check",
    "faQuestionCircle": "question-circle",
    "faCheckCircle": "check-circle",
    "faInfoCircle": "info-circle",
    "faProjectDiagram": "project-diagram",
    "faCertificate": "certificate",
    "faBookOpen": "book-open",
    "faLightbulb": "lightbulb",
    "faKey": "key",
    "faFlask": "flask",
    "faExclamationTriangle": "exclamation-triangle",
    "faSearch": "search",
    "faUsers": "users",
    "faListUl": "list-ul",
    "faTag": "tag",
    "checkbox": "checkbox",
    "done": "done",
}

CODE_ENVS: dict[str, str] = {
    "sqlcode": "sql",
    "dbtcode": "dbt",
    "yamlcode": "yaml",
    "jinjacode": "jinja",
    "pycode": "python",
    "bashcode": "bash",
    "outputcode": "output",
    "plaincode": "plain",
}

BOXES: dict[str, str] = {           # tcolorbox environment -> callout kind (or special handling)
    "whybox": "why",
    "ideabox": "idea",
    "analogybox": "analogy",
    "trapbox": "trap",
    "tipbox": "tip",
    "deepbox": "deep",
    "dbtbox": "dbt",
    "summarybox": "summary",
    "quizbox": "quiz",
    "answerbox": "answer",
    "exambox": "objectives",
    "labbox": "lab",
}

ENVS: dict[str, str] = {
    # lists
    "itemize": "o",
    "enumerate": "o",
    "description": "o",
    "questions": "o",
    "choices": "o",
    "answers": "o",
    # wrappers
    "center": "",
    "figure": "o",
    "table": "o",
    "minipage": "or",
    "multicols": "r",
    # tables
    "tabularx": "rr",
    "tabular": "or",
    "longtable": "or",
    # boxes
    **{b: ("om" if b == "labbox" else "o") for b in BOXES},
    # verbatim / raw
    **{c: "o" for c in CODE_ENVS},
    "tikzpicture": "",
}

VERBATIM_ENVS = set(CODE_ENVS)
RAW_ENVS = {"tikzpicture"}
